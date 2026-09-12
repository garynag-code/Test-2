using Accounting.Application.Abstractions;
using Accounting.Application.Security;
using Accounting.Domain.Entities;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Accounting.Application.Banking;

public sealed record ReconciliationItem(
    Guid Id,
    DateOnly Date,
    decimal Amount,
    string Description,
    string? Explanation);

/// <summary>
/// The state of a reconciliation, recomputed from posted data each time it is read.
///
/// The bank and the ledger differ for two honest reasons: a statement line imported but not yet
/// allocated is known to the bank and not to the ledger, and a ledger entry not yet presented is
/// known to the ledger and not to the bank. Anything left after both is unexplained.
/// </summary>
public sealed record ReconciliationView
{
    public required Guid ReconciliationId { get; init; }
    public required Guid BankAccountId { get; init; }
    public required DateOnly StatementDate { get; init; }
    public required decimal StatementBalance { get; init; }
    public required ReconciliationStatus Status { get; init; }

    /// <summary>Balance of the bank control account in the ledger at the statement date.</summary>
    public required decimal LedgerBalance { get; init; }

    /// <summary>Imported statement lines not yet allocated: on the bank, not in the ledger.</summary>
    public IReadOnlyList<ReconciliationItem> UnallocatedBankItems { get; init; } = [];

    /// <summary>Ledger entries explained as not yet presented: in the ledger, not on the bank.</summary>
    public IReadOnlyList<ReconciliationItem> OutstandingLedgerItems { get; init; } = [];

    /// <summary>Ledger entries on the bank account with no bank line and no explanation.</summary>
    public IReadOnlyList<ReconciliationItem> UnexplainedLedgerItems { get; init; } = [];

    public decimal UnallocatedTotal => UnallocatedBankItems.Sum(i => i.Amount);
    public decimal OutstandingTotal => OutstandingLedgerItems.Sum(i => i.Amount);

    /// <summary>What the statement should read if bank and ledger agree once timing is accounted for.</summary>
    public decimal ExpectedStatementBalance => LedgerBalance + UnallocatedTotal - OutstandingTotal;

    public decimal UnexplainedDifference =>
        decimal.Round(StatementBalance - ExpectedStatementBalance, 4);

    /// <summary>REC-AC-001 and INV-008: nothing short of exactly zero may be finalised.</summary>
    public bool CanFinalise => Status == ReconciliationStatus.Draft && UnexplainedDifference == 0m;
}

public sealed record ReconciliationOutcome(bool Succeeded, ReconciliationView? View,
    string? ErrorCode, string? Message)
{
    public static ReconciliationOutcome Ok(ReconciliationView view) => new(true, view, null, null);
    public static ReconciliationOutcome Fail(string code, string message) => new(false, null, code, message);
}

public static class ReconciliationErrors
{
    public const string NotFound = "REC.NOT_FOUND";
    public const string Forbidden = "REC.FORBIDDEN";
    public const string AlreadyFinal = "REC.ALREADY_FINAL";
    public const string DifferenceNotZero = "REC.DIFFERENCE_NOT_ZERO";
    public const string NotABankLine = "REC.NOT_A_BANK_LINE";
    public const string ExplanationRequired = "REC.EXPLANATION_REQUIRED";
    public const string AfterStatementDate = "REC.AFTER_STATEMENT_DATE";
}

/// <summary>Specification section 28.3.</summary>
public interface IBankReconciliationService
{
    Task<ReconciliationOutcome> StartAsync(Guid bankAccountId, DateOnly statementDate,
        decimal statementBalance, UserContext user, CancellationToken ct = default);

    Task<ReconciliationOutcome> GetAsync(Guid reconciliationId, UserContext user,
        CancellationToken ct = default);

    /// <summary>Explains a ledger entry as not yet presented on the statement.</summary>
    Task<ReconciliationOutcome> ExplainAsync(Guid reconciliationId, Guid journalLineId,
        string explanation, UserContext user, CancellationToken ct = default);

    Task<ReconciliationOutcome> RemoveExplanationAsync(Guid reconciliationId, Guid journalLineId,
        UserContext user, CancellationToken ct = default);

    Task<ReconciliationOutcome> FinaliseAsync(Guid reconciliationId, UserContext user,
        CancellationToken ct = default);
}

public sealed class BankReconciliationService(
    IAccountingDbContext db,
    IAuditEventWriter audit,
    IClock clock) : IBankReconciliationService
{
    private static readonly JournalStatus[] PostedStatuses = [JournalStatus.Posted, JournalStatus.Reversed];

    public async Task<ReconciliationOutcome> StartAsync(Guid bankAccountId, DateOnly statementDate,
        decimal statementBalance, UserContext user, CancellationToken ct = default)
    {
        var bankAccount = await db.BankAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == bankAccountId, ct);

        if (bankAccount is null)
            return ReconciliationOutcome.Fail(ReconciliationErrors.NotFound, "Bank account not found.");
        if (bankAccount.EntityId != user.EntityId || !user.CanPost)
            return ReconciliationOutcome.Fail(ReconciliationErrors.Forbidden,
                "User is not permitted to reconcile this bank account.");

        var reconciliation = new BankReconciliation
        {
            EntityId = user.EntityId,
            BankAccountId = bankAccountId,
            StatementDate = statementDate,
            StatementBalance = statementBalance,
            Status = ReconciliationStatus.Draft,
            PreparedBy = user.UserId,
            PreparedAtUtc = clock.UtcNow,
        };
        db.BankReconciliations.Add(reconciliation);

        audit.Append("BankReconciliationStarted", user.EntityId, nameof(BankReconciliation),
            reconciliation.Id, user, new { statementDate, statementBalance, bankAccount.Name });

        await db.SaveChangesAsync(ct);

        return ReconciliationOutcome.Ok(await BuildViewAsync(reconciliation, ct));
    }

    public async Task<ReconciliationOutcome> GetAsync(Guid reconciliationId, UserContext user,
        CancellationToken ct = default)
    {
        var (reconciliation, failure) = await LoadAsync(reconciliationId, user, ct);
        return failure ?? ReconciliationOutcome.Ok(await BuildViewAsync(reconciliation!, ct));
    }

    public async Task<ReconciliationOutcome> ExplainAsync(Guid reconciliationId, Guid journalLineId,
        string explanation, UserContext user, CancellationToken ct = default)
    {
        var (reconciliation, failure) = await LoadAsync(reconciliationId, user, ct);
        if (failure is not null) return failure;
        if (reconciliation!.Status == ReconciliationStatus.Final)
            return ReconciliationOutcome.Fail(ReconciliationErrors.AlreadyFinal,
                "A finalised reconciliation cannot be changed.");
        if (string.IsNullOrWhiteSpace(explanation))
            return ReconciliationOutcome.Fail(ReconciliationErrors.ExplanationRequired,
                "An outstanding item needs an explanation.");

        var bankAccount = await db.BankAccounts.AsNoTracking()
            .FirstAsync(a => a.Id == reconciliation.BankAccountId, ct);

        var line = await (from l in db.JournalLines.AsNoTracking()
                          join j in db.Journals.AsNoTracking() on l.JournalId equals j.Id
                          where l.Id == journalLineId
                             && l.EntityId == reconciliation.EntityId
                             && l.AccountId == bankAccount.LedgerAccountId
                             && PostedStatuses.Contains(j.Status)
                          select new { l.Id, l.DebitAmount, l.CreditAmount, j.TransactionDate })
            .FirstOrDefaultAsync(ct);

        if (line is null)
            return ReconciliationOutcome.Fail(ReconciliationErrors.NotABankLine,
                "That journal line is not a posted entry on this bank account.");
        if (line.TransactionDate > reconciliation.StatementDate)
            return ReconciliationOutcome.Fail(ReconciliationErrors.AfterStatementDate,
                "That entry falls after the statement date and is not part of this reconciliation.");

        var existing = await db.BankReconciliationLines
            .FirstOrDefaultAsync(l => l.ReconciliationId == reconciliationId
                && l.JournalLineId == journalLineId, ct);

        if (existing is null)
        {
            db.BankReconciliationLines.Add(new BankReconciliationLine
            {
                ReconciliationId = reconciliationId,
                JournalLineId = journalLineId,
                Amount = line.DebitAmount - line.CreditAmount,
                Explanation = explanation,
                CreatedBy = user.UserId,
                CreatedAtUtc = clock.UtcNow,
            });
        }
        else
        {
            existing.Explanation = explanation;
        }

        await db.SaveChangesAsync(ct);
        return ReconciliationOutcome.Ok(await BuildViewAsync(reconciliation, ct));
    }

    public async Task<ReconciliationOutcome> RemoveExplanationAsync(Guid reconciliationId,
        Guid journalLineId, UserContext user, CancellationToken ct = default)
    {
        var (reconciliation, failure) = await LoadAsync(reconciliationId, user, ct);
        if (failure is not null) return failure;
        if (reconciliation!.Status == ReconciliationStatus.Final)
            return ReconciliationOutcome.Fail(ReconciliationErrors.AlreadyFinal,
                "A finalised reconciliation cannot be changed.");

        var line = await db.BankReconciliationLines
            .FirstOrDefaultAsync(l => l.ReconciliationId == reconciliationId
                && l.JournalLineId == journalLineId, ct);

        if (line is not null)
        {
            db.BankReconciliationLines.Remove(line);
            await db.SaveChangesAsync(ct);
        }

        return ReconciliationOutcome.Ok(await BuildViewAsync(reconciliation, ct));
    }

    public async Task<ReconciliationOutcome> FinaliseAsync(Guid reconciliationId, UserContext user,
        CancellationToken ct = default)
    {
        var (reconciliation, failure) = await LoadAsync(reconciliationId, user, ct);
        if (failure is not null) return failure;
        if (reconciliation!.Status == ReconciliationStatus.Final)
            return ReconciliationOutcome.Fail(ReconciliationErrors.AlreadyFinal,
                "This reconciliation is already final.");

        var view = await BuildViewAsync(reconciliation, ct);

        // REC-AC-001 and INV-008.
        if (view.UnexplainedDifference != 0m)
            return ReconciliationOutcome.Fail(ReconciliationErrors.DifferenceNotZero,
                $"The unexplained difference is {view.UnexplainedDifference:0.00}. " +
                "A reconciliation may only be finalised at exactly zero.");

        reconciliation.Status = ReconciliationStatus.Final;
        reconciliation.FinalisedBy = user.UserId;
        reconciliation.FinalisedAtUtc = clock.UtcNow;
        reconciliation.FinalLedgerBalance = view.LedgerBalance;
        reconciliation.FinalUnallocatedTotal = view.UnallocatedTotal;
        reconciliation.FinalOutstandingTotal = view.OutstandingTotal;
        reconciliation.FinalUnexplainedDifference = 0m;

        audit.Append("BankReconciliationFinalised", user.EntityId, nameof(BankReconciliation),
            reconciliation.Id, user, new
            {
                reconciliation.StatementDate,
                reconciliation.StatementBalance,
                view.LedgerBalance,
                view.UnallocatedTotal,
                view.OutstandingTotal,
            });

        await db.SaveChangesAsync(ct);

        return ReconciliationOutcome.Ok(await BuildViewAsync(reconciliation, ct));
    }

    private async Task<ReconciliationView> BuildViewAsync(BankReconciliation reconciliation,
        CancellationToken ct)
    {
        var bankAccount = await db.BankAccounts.AsNoTracking()
            .FirstAsync(a => a.Id == reconciliation.BankAccountId, ct);

        // Every posted movement on the bank control account up to the statement date.
        var ledgerLines = await (from line in db.JournalLines.AsNoTracking()
                                 join journal in db.Journals.AsNoTracking() on line.JournalId equals journal.Id
                                 where line.EntityId == reconciliation.EntityId
                                    && line.AccountId == bankAccount.LedgerAccountId
                                    && PostedStatuses.Contains(journal.Status)
                                    && journal.TransactionDate <= reconciliation.StatementDate
                                 select new
                                 {
                                     LineId = line.Id,
                                     journal.TransactionDate,
                                     Amount = line.DebitAmount - line.CreditAmount,
                                     Description = line.Description ?? journal.Description,
                                     journal.SourceModule,
                                     journal.SourceRecordId,
                                 })
            .ToListAsync(ct);

        var ledgerBalance = ledgerLines.Sum(l => l.Amount);

        var unallocated = await db.BankTransactions.AsNoTracking()
            .Where(t => t.BankAccountId == reconciliation.BankAccountId
                && t.TransactionDate <= reconciliation.StatementDate
                && t.Status == BankTransactionStatus.Unallocated)
            .OrderBy(t => t.TransactionDate)
            .Select(t => new ReconciliationItem(t.Id, t.TransactionDate, t.Amount, t.Description, null))
            .ToListAsync(ct);

        var explanations = await db.BankReconciliationLines.AsNoTracking()
            .Where(l => l.ReconciliationId == reconciliation.Id)
            .ToDictionaryAsync(l => l.JournalLineId, l => l.Explanation, ct);

        // A ledger entry that came from an allocated bank line is on the statement by construction.
        var fromBank = ledgerLines
            .Where(l => l.SourceModule == "Banking" && l.SourceRecordId is not null)
            .Select(l => l.LineId)
            .ToHashSet();

        var outstanding = new List<ReconciliationItem>();
        var unexplained = new List<ReconciliationItem>();

        foreach (var line in ledgerLines.Where(l => !fromBank.Contains(l.LineId))
                     .OrderBy(l => l.TransactionDate))
        {
            var item = new ReconciliationItem(line.LineId, line.TransactionDate, line.Amount,
                line.Description ?? string.Empty, explanations.GetValueOrDefault(line.LineId));

            if (item.Explanation is not null) outstanding.Add(item);
            else unexplained.Add(item);
        }

        return new ReconciliationView
        {
            ReconciliationId = reconciliation.Id,
            BankAccountId = reconciliation.BankAccountId,
            StatementDate = reconciliation.StatementDate,
            StatementBalance = reconciliation.StatementBalance,
            Status = reconciliation.Status,
            LedgerBalance = ledgerBalance,
            UnallocatedBankItems = unallocated,
            OutstandingLedgerItems = outstanding,
            UnexplainedLedgerItems = unexplained,
        };
    }

    private async Task<(BankReconciliation? Reconciliation, ReconciliationOutcome? Failure)>
        LoadAsync(Guid reconciliationId, UserContext user, CancellationToken ct)
    {
        var reconciliation = await db.BankReconciliations
            .FirstOrDefaultAsync(r => r.Id == reconciliationId, ct);

        if (reconciliation is null)
            return (null, ReconciliationOutcome.Fail(ReconciliationErrors.NotFound,
                "Reconciliation not found."));
        if (reconciliation.EntityId != user.EntityId)
            return (null, ReconciliationOutcome.Fail(ReconciliationErrors.Forbidden,
                "User has no access to this entity."));

        return (reconciliation, null);
    }
}
