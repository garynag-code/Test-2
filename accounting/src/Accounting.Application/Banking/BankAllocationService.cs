using Accounting.Application.Abstractions;
using Accounting.Application.GeneralLedger;
using Accounting.Application.Security;
using Accounting.Application.Vat;
using Accounting.Domain.Entities;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Accounting.Application.Banking;

/// <summary>
/// One part of a bank transaction's allocation. The amount is gross — as it appears on the
/// statement — and the VAT is split out of it.
/// </summary>
public sealed record AllocationSplit
{
    public required Guid AccountId { get; init; }
    /// <summary>Positive, inclusive of VAT. The splits must add up to the statement amount.</summary>
    public required decimal GrossAmount { get; init; }
    public Guid? VatCodeId { get; init; }
    /// <summary>Required when allocating without VAT to an account that defaults to a taxable code.</summary>
    public string? NoVatReason { get; init; }
    public string? Description { get; init; }
}

public sealed record AllocationRequest
{
    public required Guid BankTransactionId { get; init; }
    public required IReadOnlyList<AllocationSplit> Splits { get; init; }
    /// <summary>Set when the user allocated differently from a rule's suggestion (AUT-AC-002).</summary>
    public Guid? OverriddenRuleId { get; init; }
    /// <summary>Set when the user accepted a rule's suggestion.</summary>
    public Guid? AppliedRuleId { get; init; }
}

public static class AllocationErrors
{
    public const string NotFound = "ALLOC.NOT_FOUND";
    public const string Forbidden = "ALLOC.FORBIDDEN";
    public const string AlreadyAllocated = "ALLOC.ALREADY_ALLOCATED";
    public const string NoSplits = "ALLOC.NO_SPLITS";
    public const string SplitTotalMismatch = "ALLOC.SPLIT_TOTAL_MISMATCH";
    public const string NegativeSplit = "ALLOC.NEGATIVE_SPLIT";
    public const string NoVatReasonRequired = "ALLOC.NO_VAT_REASON_REQUIRED";
    public const string NoVatControlAccount = "ALLOC.NO_VAT_CONTROL_ACCOUNT";
    public const string ZeroAmount = "ALLOC.ZERO_AMOUNT";
}

public sealed record AllocationResult(
    bool Succeeded,
    Guid? JournalId,
    string? JournalNumber,
    IReadOnlyList<PostError> Errors)
{
    public static AllocationResult Fail(string code, string message) =>
        new(false, null, null, [new PostError(code, message)]);
    public static AllocationResult Fail(IReadOnlyList<PostError> errors) => new(false, null, null, errors);
}

public interface IBankAllocationService
{
    Task<AllocationResult> AllocateAsync(AllocationRequest request, UserContext user,
        CancellationToken ct = default);
}

/// <summary>
/// Turns an imported bank line into a posted journal. Specification section 13: the cashbook builds a
/// posting request and hands it to the posting service; it never writes ledger rows itself.
/// </summary>
public sealed class BankAllocationService(
    IAccountingDbContext db,
    IPostingService posting,
    IVatCalculationService vat,
    IAuditEventWriter audit,
    IClock clock) : IBankAllocationService
{
    public async Task<AllocationResult> AllocateAsync(AllocationRequest request, UserContext user,
        CancellationToken ct = default)
    {
        var transaction = await db.BankTransactions
            .FirstOrDefaultAsync(t => t.Id == request.BankTransactionId, ct);

        if (transaction is null)
            return AllocationResult.Fail(AllocationErrors.NotFound, "Bank transaction not found.");
        if (transaction.EntityId != user.EntityId)
            return AllocationResult.Fail(AllocationErrors.Forbidden, "User has no access to this entity.");

        // INV-007: a bank line reaches the ledger once. Correct an allocation by reversing its journal.
        if (transaction.Status == BankTransactionStatus.Allocated || transaction.JournalId is not null)
            return AllocationResult.Fail(AllocationErrors.AlreadyAllocated,
                "This bank transaction has already been posted. Reverse its journal to re-allocate it.");

        if (request.Splits.Count == 0)
            return AllocationResult.Fail(AllocationErrors.NoSplits, "An allocation needs at least one split.");
        if (transaction.Amount == 0m)
            return AllocationResult.Fail(AllocationErrors.ZeroAmount,
                "A zero-value bank line cannot be allocated.");
        if (request.Splits.Any(s => s.GrossAmount <= 0m))
            return AllocationResult.Fail(AllocationErrors.NegativeSplit,
                "Each split is a positive amount; the bank line's own sign decides the direction.");

        var statementAmount = Math.Abs(transaction.Amount);
        var splitTotal = request.Splits.Sum(s => s.GrossAmount);
        if (decimal.Round(splitTotal, 4) != decimal.Round(statementAmount, 4))
            return AllocationResult.Fail(AllocationErrors.SplitTotalMismatch,
                $"Splits total {splitTotal:0.00} but the bank line is {statementAmount:0.00}.");

        var bankAccount = await db.BankAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == transaction.BankAccountId, ct);
        if (bankAccount is null)
            return AllocationResult.Fail(AllocationErrors.NotFound, "Bank account not found.");

        var moneyIn = transaction.Amount > 0m;
        var lines = new List<PostLineRequest>();
        var totalVat = 0m;

        foreach (var split in request.Splits)
        {
            var account = await db.Accounts.AsNoTracking()
                .FirstOrDefaultAsync(a => a.Id == split.AccountId && a.EntityId == user.EntityId, ct);
            if (account is null)
                return AllocationResult.Fail(AllocationErrors.NotFound,
                    "An allocated account was not found for this entity.");

            decimal net = split.GrossAmount, splitVat = 0m;

            if (split.VatCodeId is { } vatCodeId)
            {
                var calculation = await vat.CalculateAsync(user.EntityId, vatCodeId, split.GrossAmount,
                    amountIncludesVat: true, transaction.TransactionDate, ct);
                if (!calculation.Succeeded)
                    return AllocationResult.Fail(calculation.ErrorCode!, calculation.Message!);

                net = calculation.Calculation!.TaxableAmount;
                splitVat = calculation.Calculation.VatAmount;
                totalVat += splitVat;
            }
            else if (await RequiresNoVatReasonAsync(account, transaction.TransactionDate, ct)
                     && string.IsNullOrWhiteSpace(split.NoVatReason))
            {
                // Specification section 12.3, enforced here rather than in the ledger (DECISIONS D-012).
                return AllocationResult.Fail(AllocationErrors.NoVatReasonRequired,
                    $"Account {account.Code} defaults to a taxable VAT code. " +
                    "Supply a VAT code, or a reason for allocating without VAT.");
            }

            lines.Add(new PostLineRequest
            {
                AccountId = split.AccountId,
                DebitAmount = moneyIn ? 0m : net,
                CreditAmount = moneyIn ? net : 0m,
                Description = split.Description ?? transaction.Description,
                Reference = transaction.Description,
                VatCodeId = split.VatCodeId,
                VatAmount = split.VatCodeId is null ? null : splitVat,
                VatDirection = moneyIn ? VatDirection.Output : VatDirection.Input,
                NoVatReason = split.NoVatReason,
            });
        }

        if (totalVat > 0m)
        {
            var vatControl = await db.Accounts.AsNoTracking()
                .FirstOrDefaultAsync(a => a.EntityId == user.EntityId
                    && a.ControlAccountType == ControlAccountType.Vat && a.Active, ct);
            if (vatControl is null)
                return AllocationResult.Fail(AllocationErrors.NoVatControlAccount,
                    "No active VAT control account is configured for this entity.");

            lines.Add(new PostLineRequest
            {
                AccountId = vatControl.Id,
                DebitAmount = moneyIn ? 0m : totalVat,
                CreditAmount = moneyIn ? totalVat : 0m,
                Description = $"VAT on {transaction.Description}",
            });
        }

        // The bank side carries the statement amount in full, VAT included.
        lines.Add(new PostLineRequest
        {
            AccountId = bankAccount.LedgerAccountId,
            DebitAmount = moneyIn ? statementAmount : 0m,
            CreditAmount = moneyIn ? 0m : statementAmount,
            Description = transaction.Description,
            Reference = transaction.Description,
        });

        var postRequest = new PostRequest
        {
            EntityId = user.EntityId,
            TransactionDate = transaction.TransactionDate,
            JournalType = JournalType.BNK,
            Description = transaction.Description,
            Reference = bankAccount.Name,
            SourceModule = "Banking",
            // Makes the posting idempotent per bank line, enforced by the unique index (INV-007).
            SourceRecordId = transaction.Id,
            Lines = lines,
        };

        var posted = await posting.PostAsync(postRequest, user, ct);
        if (!posted.Succeeded) return AllocationResult.Fail(posted.Errors);

        transaction.Status = BankTransactionStatus.Allocated;
        transaction.JournalId = posted.JournalId;

        await RecordRuleOutcomeAsync(request, user, ct);

        audit.Append("BankTransactionAllocated", user.EntityId, nameof(BankTransaction), transaction.Id,
            user, new
            {
                transaction.TransactionDate,
                transaction.Amount,
                transaction.Description,
                JournalNumber = posted.JournalNumber,
                SplitCount = request.Splits.Count,
                Vat = totalVat,
                request.AppliedRuleId,
                request.OverriddenRuleId,
            });

        await db.SaveChangesAsync(ct);

        return new AllocationResult(true, posted.JournalId, posted.JournalNumber, []);
    }

    /// <summary>
    /// Keeps a rule's confidence in step with how it performs. A rule the user keeps overriding falls
    /// below the suggestible threshold and stops being offered (AUT-AC-002).
    /// </summary>
    private async Task RecordRuleOutcomeAsync(AllocationRequest request, UserContext user,
        CancellationToken ct)
    {
        if (request.AppliedRuleId is { } appliedId)
        {
            var applied = await db.AllocationRules.FirstOrDefaultAsync(
                r => r.Id == appliedId && r.EntityId == user.EntityId, ct);
            if (applied is not null)
            {
                applied.TimesApplied++;
                applied.LastAppliedAtUtc = clock.UtcNow;
                applied.Confidence = Math.Min(100, applied.Confidence + 1);
            }
        }

        if (request.OverriddenRuleId is { } overriddenId && overriddenId != request.AppliedRuleId)
        {
            var overridden = await db.AllocationRules.FirstOrDefaultAsync(
                r => r.Id == overriddenId && r.EntityId == user.EntityId, ct);
            if (overridden is not null)
            {
                overridden.TimesOverridden++;
                overridden.Confidence = Math.Max(0, overridden.Confidence - 20);
                overridden.UpdatedAtUtc = clock.UtcNow;
                overridden.UpdatedBy = user.UserId;
            }
        }
    }

    private async Task<bool> RequiresNoVatReasonAsync(Account account, DateOnly date, CancellationToken ct)
    {
        if (account.DefaultVatCodeId is not { } defaultCode) return false;
        var rate = await vat.ResolveRateAsync(defaultCode, date, ct);
        return rate is > 0m;
    }
}
