using Accounting.Application.Abstractions;
using Accounting.Application.Security;
using Accounting.Domain.Entities;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Accounting.Application.GeneralLedger;

/// <summary>
/// The only service permitted to create posted journal lines (specification sections 5.4 and 11.2).
/// Validation, numbering and persistence all happen inside one database transaction.
/// </summary>
public sealed class PostingService(
    IAccountingDbContext db,
    IAuditEventWriter audit,
    IClock clock) : IPostingService
{
    /// <summary>Monetary scale from specification section 8.1 (numeric(19,4)).</summary>
    private const int MoneyScale = 4;

    public async Task<PostResult> ValidateAsync(PostRequest request, UserContext user, CancellationToken ct = default)
    {
        var (errors, _, _) = await ValidateCoreAsync(request, user, ct);
        return errors.Count == 0 ? new PostResult() : new PostResult { Errors = errors };
    }

    public async Task<PostResult> PostAsync(PostRequest request, UserContext user, CancellationToken ct = default)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var (errors, period, accounts) = await ValidateCoreAsync(request, user, ct);
        if (errors.Count > 0)
        {
            // Nothing is written when validation fails (GL-AC-001).
            await tx.RollbackAsync(ct);
            return new PostResult { Errors = errors };
        }

        var journal = BuildJournal(request, period!, user);
        journal.JournalNumber = await NextJournalNumberAsync(request.EntityId, request.JournalType, ct);

        var lineNo = 1;
        foreach (var line in request.Lines)
        {
            journal.Lines.Add(new JournalLine
            {
                JournalId = journal.Id,
                EntityId = request.EntityId,
                LineNo = lineNo++,
                AccountId = line.AccountId,
                DebitAmount = decimal.Round(line.DebitAmount, MoneyScale),
                CreditAmount = decimal.Round(line.CreditAmount, MoneyScale),
                Description = line.Description ?? request.Description,
                Reference = line.Reference ?? request.Reference,
                DocumentLinkId = line.DocumentLinkId,
            });
        }

        db.Journals.Add(journal);
        audit.Append("JournalPosted", journal.EntityId, nameof(Journal), journal.Id, user, new
        {
            journal.JournalNumber,
            JournalType = journal.JournalType.ToString(),
            journal.TransactionDate,
            Debit = journal.TotalDebit,
            Credit = journal.TotalCredit,
            LineCount = journal.Lines.Count,
        });

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return PostResult.Ok(journal.Id, journal.JournalNumber);
    }

    public async Task<PostResult> ValidateDraftAsync(Guid journalId, UserContext user, CancellationToken ct = default)
    {
        var (draft, request, failure) = await LoadDraftAsync(journalId, user, ct);
        if (failure is not null) return failure;

        var (errors, _, _) = await ValidateCoreAsync(request!, user, ct);
        return errors.Count == 0 ? new PostResult { JournalId = draft!.Id } : new PostResult { Errors = errors };
    }

    public async Task<PostResult> PostDraftAsync(Guid journalId, UserContext user, CancellationToken ct = default)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var (draft, request, failure) = await LoadDraftAsync(journalId, user, ct);
        if (failure is not null) return failure;

        var (errors, period, _) = await ValidateCoreAsync(request!, user, ct);
        if (errors.Count > 0)
        {
            await tx.RollbackAsync(ct);
            return new PostResult { Errors = errors };
        }

        // The draft becomes the posted journal; no second record is created.
        draft!.PeriodId = period!.Id;
        draft.Status = JournalStatus.Posted;
        draft.PostedBy = user.UserId;
        draft.PostedAtUtc = clock.UtcNow;
        draft.JournalNumber = await NextJournalNumberAsync(draft.EntityId, draft.JournalType, ct);

        foreach (var line in draft.Lines)
        {
            line.DebitAmount = decimal.Round(line.DebitAmount, MoneyScale);
            line.CreditAmount = decimal.Round(line.CreditAmount, MoneyScale);
        }

        audit.Append("JournalPosted", draft.EntityId, nameof(Journal), draft.Id, user, new
        {
            draft.JournalNumber,
            JournalType = draft.JournalType.ToString(),
            draft.TransactionDate,
            Debit = draft.TotalDebit,
            Credit = draft.TotalCredit,
            LineCount = draft.Lines.Count,
            FromDraft = true,
        });

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return PostResult.Ok(draft.Id, draft.JournalNumber);
    }

    private async Task<(Journal? Draft, PostRequest? Request, PostResult? Failure)> LoadDraftAsync(
        Guid journalId, UserContext user, CancellationToken ct)
    {
        var draft = await db.Journals.Include(j => j.Lines).FirstOrDefaultAsync(j => j.Id == journalId, ct);
        if (draft is null)
            return (null, null, PostResult.Fail(PostingErrors.NotFound, "Journal not found."));
        if (draft.EntityId != user.EntityId)
            return (null, null, PostResult.Fail(PostingErrors.Forbidden, "User has no access to this entity."));
        if (draft.Status != JournalStatus.Draft)
            return (null, null, PostResult.Fail(PostingErrors.JournalImmutable,
                "Only a draft journal can be posted; a posted journal is corrected by reversal."));

        var request = new PostRequest
        {
            EntityId = draft.EntityId,
            TransactionDate = draft.TransactionDate,
            JournalType = draft.JournalType,
            Description = draft.Description,
            Reference = draft.Reference,
            SourceModule = draft.SourceModule,
            // The draft already occupies the source slot; re-checking it against itself would be a false duplicate.
            SourceRecordId = null,
            Lines = [.. draft.Lines.OrderBy(l => l.LineNo).Select(l => new PostLineRequest
            {
                AccountId = l.AccountId,
                DebitAmount = l.DebitAmount,
                CreditAmount = l.CreditAmount,
                Description = l.Description,
                Reference = l.Reference,
                DocumentLinkId = l.DocumentLinkId,
            })],
        };

        return (draft, request, null);
    }

    public async Task<PostResult> ReverseAsync(Guid journalId, DateOnly reversalDate, string reason,
        UserContext user, CancellationToken ct = default)
    {
        if (!user.CanPost)
            return PostResult.Fail(PostingErrors.Forbidden, "User is not permitted to post or reverse journals.");
        if (string.IsNullOrWhiteSpace(reason))
            return PostResult.Fail(PostingErrors.InvalidLine, "A reversal reason is required.");

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var original = await db.Journals
            .Include(j => j.Lines)
            .FirstOrDefaultAsync(j => j.Id == journalId, ct);

        if (original is null)
            return PostResult.Fail(PostingErrors.NotFound, "Journal not found.");
        if (original.EntityId != user.EntityId)
            return PostResult.Fail(PostingErrors.Forbidden, "User has no access to this entity.");
        if (original.Status != JournalStatus.Posted)
            return original.Status == JournalStatus.Reversed
                ? PostResult.Fail(PostingErrors.AlreadyReversed, "Journal has already been reversed.")
                : PostResult.Fail(PostingErrors.NotPosted, "Only a posted journal can be reversed.");

        // The reversal is an ordinary posting: it must satisfy every invariant in its own right.
        var reversalRequest = new PostRequest
        {
            EntityId = original.EntityId,
            TransactionDate = reversalDate,
            JournalType = JournalType.REV,
            Description = $"Reversal of {original.JournalNumber}: {reason}",
            Reference = original.Reference,
            SourceModule = original.SourceModule,
            Lines = [.. original.Lines
                .OrderBy(l => l.LineNo)
                .Select(l => new PostLineRequest
                {
                    AccountId = l.AccountId,
                    DebitAmount = l.CreditAmount,
                    CreditAmount = l.DebitAmount,
                    Description = l.Description,
                    Reference = l.Reference,
                    DocumentLinkId = l.DocumentLinkId, // INV-005: evidence links are preserved
                })],
        };

        var (errors, period, _) = await ValidateCoreAsync(reversalRequest, user, ct);
        if (errors.Count > 0)
        {
            await tx.RollbackAsync(ct);
            return new PostResult { Errors = errors };
        }

        var reversal = BuildJournal(reversalRequest, period!, user);
        reversal.ReversalOfJournalId = original.Id;
        reversal.ReversalReason = reason;
        reversal.JournalNumber = await NextJournalNumberAsync(original.EntityId, JournalType.REV, ct);

        var lineNo = 1;
        foreach (var line in reversalRequest.Lines)
        {
            reversal.Lines.Add(new JournalLine
            {
                JournalId = reversal.Id,
                EntityId = original.EntityId,
                LineNo = lineNo++,
                AccountId = line.AccountId,
                DebitAmount = line.DebitAmount,
                CreditAmount = line.CreditAmount,
                Description = line.Description,
                Reference = line.Reference,
                DocumentLinkId = line.DocumentLinkId,
            });
        }

        db.Journals.Add(reversal);

        // The only mutation permitted on a posted journal: recording that it has been reversed.
        original.Status = JournalStatus.Reversed;
        original.ReversedByJournalId = reversal.Id;

        audit.Append("JournalReversed", original.EntityId, nameof(Journal), original.Id, user, new
        {
            OriginalJournalNumber = original.JournalNumber,
            ReversalJournalNumber = reversal.JournalNumber,
            ReversalDate = reversalDate,
            Reason = reason,
        });

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return PostResult.Ok(reversal.Id, reversal.JournalNumber);
    }

    private Journal BuildJournal(PostRequest request, AccountingPeriod period, UserContext user) => new()
    {
        EntityId = request.EntityId,
        JournalNumber = string.Empty,
        JournalType = request.JournalType,
        TransactionDate = request.TransactionDate,
        PeriodId = period.Id,
        Description = request.Description,
        Reference = request.Reference,
        SourceModule = request.SourceModule,
        SourceRecordId = request.SourceRecordId,
        Status = JournalStatus.Posted,
        CreatedBy = user.UserId,
        CreatedAtUtc = clock.UtcNow,
        PostedBy = user.UserId,
        PostedAtUtc = clock.UtcNow,
    };

    private async Task<(List<PostError> Errors, AccountingPeriod? Period, Dictionary<Guid, Account> Accounts)>
        ValidateCoreAsync(PostRequest request, UserContext user, CancellationToken ct)
    {
        var errors = new List<PostError>();
        var accounts = new Dictionary<Guid, Account>();

        // Entity-level authorisation is enforced here, not only in the API layer (SEC-AC-001).
        if (request.EntityId != user.EntityId)
        {
            errors.Add(new PostError(PostingErrors.Forbidden, "User has no access to this entity."));
            return (errors, null, accounts);
        }

        if (!user.CanPost)
        {
            errors.Add(new PostError(PostingErrors.Forbidden, "User is not permitted to post journals."));
            return (errors, null, accounts);
        }

        var entity = await db.Entities.AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == request.EntityId, ct);
        if (entity is null)
        {
            errors.Add(new PostError(PostingErrors.NotFound, "Entity not found."));
            return (errors, null, accounts);
        }
        if (!entity.Active)
            errors.Add(new PostError(PostingErrors.EntityInactive, "Entity is inactive."));

        if (request.Lines.Count < 2)
            errors.Add(new PostError(PostingErrors.TooFewLines, "A journal requires at least two lines."));

        // Line-level validation.
        decimal totalDebit = 0m, totalCredit = 0m;
        var accountIds = request.Lines.Select(l => l.AccountId).Distinct().ToList();
        accounts = await db.Accounts.AsNoTracking()
            .Where(a => accountIds.Contains(a.Id))
            .ToDictionaryAsync(a => a.Id, ct);

        for (var i = 0; i < request.Lines.Count; i++)
        {
            var line = request.Lines[i];
            var lineNo = i + 1;

            if (line.DebitAmount < 0m || line.CreditAmount < 0m)
                errors.Add(new PostError(PostingErrors.InvalidLine,
                    $"Line {lineNo}: negative amounts are not permitted; use the opposite debit/credit side."));
            else if (line.DebitAmount == 0m && line.CreditAmount == 0m)
                errors.Add(new PostError(PostingErrors.ZeroValue, $"Line {lineNo}: amount is zero."));
            else if (line.DebitAmount > 0m && line.CreditAmount > 0m)
                errors.Add(new PostError(PostingErrors.InvalidLine,
                    $"Line {lineNo}: a line may carry either a debit or a credit, not both."));

            if (ExceedsMoneyScale(line.DebitAmount) || ExceedsMoneyScale(line.CreditAmount))
                errors.Add(new PostError(PostingErrors.PrecisionExceeded,
                    $"Line {lineNo}: amounts may not have more than {MoneyScale} decimal places."));

            if (!accounts.TryGetValue(line.AccountId, out var account))
            {
                errors.Add(new PostError(PostingErrors.AccountNotFound, $"Line {lineNo}: account not found."));
            }
            else
            {
                if (account.EntityId != request.EntityId)
                    errors.Add(new PostError(PostingErrors.WrongEntity,
                        $"Line {lineNo}: account {account.Code} belongs to another entity."));
                if (!account.PostingAllowed)
                    errors.Add(new PostError(PostingErrors.NonPostingAccount,
                        $"Line {lineNo}: account {account.Code} is a header account and does not accept postings."));
                if (!account.Active)
                    errors.Add(new PostError(PostingErrors.AccountInactive,
                        $"Line {lineNo}: account {account.Code} is inactive."));
            }

            totalDebit += line.DebitAmount;
            totalCredit += line.CreditAmount;
        }

        // INV-001: exact equality, evaluated on decimal values only.
        if (decimal.Round(totalDebit, MoneyScale) != decimal.Round(totalCredit, MoneyScale))
            errors.Add(new PostError(PostingErrors.Unbalanced,
                $"Journal does not balance: debits {totalDebit:0.0000}, credits {totalCredit:0.0000}."));

        // INV-003: the transaction date must fall in a period that accepts the posting.
        var period = await db.AccountingPeriods
            .FirstOrDefaultAsync(p => p.EntityId == request.EntityId
                && p.StartDate <= request.TransactionDate
                && p.EndDate >= request.TransactionDate, ct);

        if (period is null)
        {
            errors.Add(new PostError(PostingErrors.NoPeriod,
                $"No accounting period covers {request.TransactionDate:yyyy-MM-dd}."));
        }
        else if (!period.AcceptsOrdinaryPosting)
        {
            var allowed = period.AcceptsElevatedPosting && user.HasElevatedPermission;
            if (!allowed)
                errors.Add(new PostError(PostingErrors.PeriodNotOpen,
                    $"Period {period.Name} is {period.Status}; posting is not permitted."));
        }

        // Source uniqueness, so a subledger or bank line cannot post twice (INV-007).
        if (request.SourceRecordId is { } sourceId)
        {
            var duplicate = await db.Journals.AsNoTracking().AnyAsync(j =>
                j.EntityId == request.EntityId &&
                j.SourceModule == request.SourceModule &&
                j.SourceRecordId == sourceId, ct);
            if (duplicate)
                errors.Add(new PostError(PostingErrors.DuplicateSource,
                    "A journal has already been posted for this source record."));
        }

        return (errors, period, accounts);
    }

    private static bool ExceedsMoneyScale(decimal value) => decimal.Round(value, MoneyScale) != value;

    private async Task<string> NextJournalNumberAsync(Guid entityId, JournalType type, CancellationToken ct)
    {
        var prefix = type.ToString();
        var sequence = await db.JournalNumberSequences
            .FirstOrDefaultAsync(s => s.EntityId == entityId && s.Prefix == prefix, ct);

        if (sequence is null)
        {
            sequence = new JournalNumberSequence { EntityId = entityId, Prefix = prefix, NextNumber = 1 };
            db.JournalNumberSequences.Add(sequence);
        }

        var number = sequence.NextNumber;
        sequence.NextNumber = number + 1;
        return $"{prefix}-{number:D6}";
    }
}
