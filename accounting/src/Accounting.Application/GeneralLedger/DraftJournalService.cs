using Accounting.Application.Abstractions;
using Accounting.Application.Security;
using Accounting.Domain.Entities;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Accounting.Application.GeneralLedger;

public interface IDraftJournalService
{
    Task<(Journal? Journal, PostResult Result)> CreateAsync(PostRequest request, UserContext user,
        CancellationToken ct = default);
    Task<PostResult> DeleteAsync(Guid journalId, UserContext user, CancellationToken ct = default);
}

/// <summary>
/// Draft journal capture. Drafts are not accounting records: they carry no journal number and are
/// excluded from every ledger query until the posting service accepts them (specification section 8.3).
/// </summary>
public sealed class DraftJournalService(IAccountingDbContext db, IAuditEventWriter audit, IClock clock)
    : IDraftJournalService
{
    public async Task<(Journal?, PostResult)> CreateAsync(PostRequest request, UserContext user,
        CancellationToken ct = default)
    {
        if (request.EntityId != user.EntityId)
            return (null, PostResult.Fail(PostingErrors.Forbidden, "User has no access to this entity."));
        if (!user.CanPost && !user.IsInRole(Roles.DataCapturer))
            return (null, PostResult.Fail(PostingErrors.Forbidden, "User is not permitted to capture journals."));

        var period = await db.AccountingPeriods.AsNoTracking()
            .FirstOrDefaultAsync(p => p.EntityId == request.EntityId
                && p.StartDate <= request.TransactionDate && p.EndDate >= request.TransactionDate, ct);
        if (period is null)
            return (null, PostResult.Fail(PostingErrors.NoPeriod,
                $"No accounting period covers {request.TransactionDate:yyyy-MM-dd}."));

        var journal = new Journal
        {
            EntityId = request.EntityId,
            JournalNumber = $"DRAFT-{Guid.NewGuid():N}"[..24],
            JournalType = request.JournalType,
            TransactionDate = request.TransactionDate,
            PeriodId = period.Id,
            Description = request.Description,
            Reference = request.Reference,
            SourceModule = request.SourceModule,
            SourceRecordId = request.SourceRecordId,
            Status = JournalStatus.Draft,
            CreatedBy = user.UserId,
            CreatedAtUtc = clock.UtcNow,
        };

        var lineNo = 1;
        foreach (var line in request.Lines)
        {
            journal.Lines.Add(new JournalLine
            {
                JournalId = journal.Id,
                EntityId = request.EntityId,
                LineNo = lineNo++,
                AccountId = line.AccountId,
                DebitAmount = line.DebitAmount,
                CreditAmount = line.CreditAmount,
                Description = line.Description ?? request.Description,
                Reference = line.Reference ?? request.Reference,
                DocumentLinkId = line.DocumentLinkId,
            });
        }

        db.Journals.Add(journal);
        await db.SaveChangesAsync(ct);
        return (journal, PostResult.Ok(journal.Id, journal.JournalNumber));
    }

    public async Task<PostResult> DeleteAsync(Guid journalId, UserContext user, CancellationToken ct = default)
    {
        var journal = await db.Journals.Include(j => j.Lines).FirstOrDefaultAsync(j => j.Id == journalId, ct);
        if (journal is null) return PostResult.Fail(PostingErrors.NotFound, "Journal not found.");
        if (journal.EntityId != user.EntityId)
            return PostResult.Fail(PostingErrors.Forbidden, "User has no access to this entity.");

        // INV-004: posted journals are never deleted; they are corrected by reversal.
        if (journal.Status != JournalStatus.Draft)
            return PostResult.Fail(PostingErrors.JournalImmutable,
                "Only a draft journal may be deleted. Correct a posted journal by reversal.");

        db.JournalLines.RemoveRange(journal.Lines);
        db.Journals.Remove(journal);
        audit.Append("DraftJournalDeleted", journal.EntityId, nameof(Journal), journal.Id, user,
            new { journal.TransactionDate, LineCount = journal.Lines.Count });
        await db.SaveChangesAsync(ct);
        return PostResult.Ok(journal.Id, journal.JournalNumber);
    }
}
