using System.Text;
using Accounting.Application.Banking;
using Accounting.Application.GeneralLedger;
using Accounting.Domain.Entities;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Integration.Tests;

/// <summary>
/// Allocating imported bank lines to the ledger. Specification sections 13, 15 and 16.
/// </summary>
[Collection("database")]
public class BankAllocationTests(DatabaseFixture fixture)
{
    private static Stream Content(string text) => new MemoryStream(Encoding.UTF8.GetBytes(text));

    private static async Task<Guid> VatCodeIdAsync(LedgerScenario scenario, string code) =>
        await scenario.Db.VatCodes.AsNoTracking()
            .Where(v => v.EntityId == scenario.EntityId && v.Code == code)
            .Select(v => v.Id).FirstAsync();

    /// <summary>Imports one statement line and returns it.</summary>
    private static async Task<BankTransaction> ImportOneAsync(LedgerScenario scenario,
        string description, decimal amount, string date = "08 09 2026")
    {
        var csv = $"""
            ACCOUNT TRANSACTION HISTORY,,,
            Date, Amount, Balance, Description
            {date},{amount:0.00},0.00,{description}
            """;

        var result = await scenario.BankImport.CommitAsync(scenario.BankAccountId,
            $"{Guid.NewGuid():N}.csv", Content(csv), scenario.Preparer);
        Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Message)));

        return await scenario.Db.BankTransactions.AsNoTracking()
            .FirstAsync(t => t.ImportBatchId == result.BatchId);
    }

    /// <summary>
    /// A VAT-inclusive payment: the specification's section 12.4 example, arriving from a bank line.
    /// </summary>
    [Fact]
    public async Task Payment_allocates_to_net_expense_vat_input_and_bank()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var transaction = await ImportOneAsync(scenario, "OFFICE SUPPLIES", -1150.00m);

        var result = await scenario.Allocation.AllocateAsync(new AllocationRequest
        {
            BankTransactionId = transaction.Id,
            Splits =
            [
                new AllocationSplit
                {
                    AccountId = scenario.Account("6070"),
                    GrossAmount = 1150.00m,
                    VatCodeId = await VatCodeIdAsync(scenario, "01"),
                },
            ],
        }, scenario.Preparer);

        Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Message)));
        Assert.StartsWith("BNK-", result.JournalNumber);

        var lines = await scenario.Db.JournalLines.AsNoTracking()
            .Include(l => l.Account)
            .Where(l => l.JournalId == result.JournalId)
            .ToListAsync();

        Assert.Equal(3, lines.Count);
        Assert.Equal(1000.00m, lines.Single(l => l.Account!.Code == "6070").DebitAmount);
        Assert.Equal(150.00m, lines.Single(l => l.Account!.Code == "2100").DebitAmount);
        Assert.Equal(1150.00m, lines.Single(l => l.Account!.Code == "1000").CreditAmount);

        var allocated = await scenario.Db.BankTransactions.AsNoTracking().FirstAsync(t => t.Id == transaction.Id);
        Assert.Equal(BankTransactionStatus.Allocated, allocated.Status);
        Assert.Equal(result.JournalId, allocated.JournalId);
    }

    /// <summary>A receipt reverses the direction: bank debited, income and output VAT credited.</summary>
    [Fact]
    public async Task Receipt_allocates_to_bank_debit_and_income_credit()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var transaction = await ImportOneAsync(scenario, "CUSTOMER DEPOSIT", 11500.00m);

        var result = await scenario.Allocation.AllocateAsync(new AllocationRequest
        {
            BankTransactionId = transaction.Id,
            Splits =
            [
                new AllocationSplit
                {
                    AccountId = scenario.Account("4000"),
                    GrossAmount = 11500.00m,
                    VatCodeId = await VatCodeIdAsync(scenario, "01"),
                },
            ],
        }, scenario.Preparer);

        Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Message)));

        var lines = await scenario.Db.JournalLines.AsNoTracking()
            .Include(l => l.Account)
            .Where(l => l.JournalId == result.JournalId).ToListAsync();

        Assert.Equal(11500.00m, lines.Single(l => l.Account!.Code == "1000").DebitAmount);
        Assert.Equal(10000.00m, lines.Single(l => l.Account!.Code == "4000").CreditAmount);
        Assert.Equal(1500.00m, lines.Single(l => l.Account!.Code == "2100").CreditAmount);

        var taxLine = await scenario.Db.TaxLines.AsNoTracking().FirstAsync(t => t.EntityId == scenario.EntityId);
        Assert.Equal(VatDirection.Output, taxLine.Direction);
    }

    /// <summary>An FNB monthly account fee: R655 inclusive splits to R569.57 and R85.43 input VAT.</summary>
    [Fact]
    public async Task Bank_charge_splits_out_its_input_vat()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var transaction = await ImportOneAsync(scenario, "#MONTHLY ACCOUNT FEE", -655.00m);

        var result = await scenario.Allocation.AllocateAsync(new AllocationRequest
        {
            BankTransactionId = transaction.Id,
            Splits =
            [
                new AllocationSplit
                {
                    AccountId = scenario.Account("6020"),
                    GrossAmount = 655.00m,
                    VatCodeId = await VatCodeIdAsync(scenario, "01"),
                },
            ],
        }, scenario.Preparer);

        Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Message)));

        var lines = await scenario.Db.JournalLines.AsNoTracking()
            .Include(l => l.Account)
            .Where(l => l.JournalId == result.JournalId).ToListAsync();

        Assert.Equal(569.57m, lines.Single(l => l.Account!.Code == "6020").DebitAmount);
        Assert.Equal(85.43m, lines.Single(l => l.Account!.Code == "2100").DebitAmount);
        Assert.Equal(655.00m, lines.Single(l => l.Account!.Code == "1000").CreditAmount);
    }

    /// <summary>Specification section 12.3: one bank line split across codes with different VAT.</summary>
    [Fact]
    public async Task A_line_can_be_split_across_accounts_with_different_vat_codes()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var transaction = await ImportOneAsync(scenario, "MIXED PURCHASE", -2150.00m);

        var result = await scenario.Allocation.AllocateAsync(new AllocationRequest
        {
            BankTransactionId = transaction.Id,
            Splits =
            [
                new AllocationSplit
                {
                    AccountId = scenario.Account("6070"),
                    GrossAmount = 1150.00m,
                    VatCodeId = await VatCodeIdAsync(scenario, "01"),
                },
                new AllocationSplit
                {
                    AccountId = scenario.Account("6100"),
                    GrossAmount = 1000.00m,
                    VatCodeId = await VatCodeIdAsync(scenario, "00"),
                },
            ],
        }, scenario.Preparer);

        Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Message)));

        var lines = await scenario.Db.JournalLines.AsNoTracking()
            .Include(l => l.Account)
            .Where(l => l.JournalId == result.JournalId).ToListAsync();

        Assert.Equal(1000.00m, lines.Single(l => l.Account!.Code == "6070").DebitAmount);
        Assert.Equal(1000.00m, lines.Single(l => l.Account!.Code == "6100").DebitAmount);
        Assert.Equal(150.00m, lines.Single(l => l.Account!.Code == "2100").DebitAmount);
        Assert.Equal(2150.00m, lines.Single(l => l.Account!.Code == "1000").CreditAmount);
    }

    [Fact]
    public async Task Splits_that_do_not_add_up_to_the_bank_line_are_refused()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var transaction = await ImportOneAsync(scenario, "OFFICE SUPPLIES", -1150.00m);

        var result = await scenario.Allocation.AllocateAsync(new AllocationRequest
        {
            BankTransactionId = transaction.Id,
            Splits = [new AllocationSplit { AccountId = scenario.Account("6070"), GrossAmount = 1000.00m }],
        }, scenario.Preparer);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == AllocationErrors.SplitTotalMismatch);
        Assert.False(await scenario.Db.Journals.AnyAsync(j => j.EntityId == scenario.EntityId));
    }

    /// <summary>INV-007: a bank line may not post twice.</summary>
    [Fact]
    public async Task A_bank_line_cannot_be_allocated_twice()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var transaction = await ImportOneAsync(scenario, "OFFICE SUPPLIES", -1150.00m);

        AllocationRequest Request() => new()
        {
            BankTransactionId = transaction.Id,
            Splits =
            [
                new AllocationSplit
                {
                    AccountId = scenario.Account("6070"),
                    GrossAmount = 1150.00m,
                    VatCodeId = null,
                    NoVatReason = "Supplier is not a VAT vendor",
                },
            ],
        };

        Assert.True((await scenario.Allocation.AllocateAsync(Request(), scenario.Preparer)).Succeeded);

        scenario.Db.ChangeTracker.Clear();
        var second = await scenario.Allocation.AllocateAsync(Request(), scenario.Preparer);

        Assert.False(second.Succeeded);
        Assert.Contains(second.Errors, e => e.Code == AllocationErrors.AlreadyAllocated);
        Assert.Equal(1, await scenario.Db.Journals.CountAsync(j => j.EntityId == scenario.EntityId));
    }

    /// <summary>Specification section 12.3, enforced at allocation rather than in the ledger.</summary>
    [Fact]
    public async Task Allocating_without_vat_to_a_taxable_account_requires_a_reason()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var transaction = await ImportOneAsync(scenario, "OFFICE SUPPLIES", -1150.00m);

        AllocationRequest Request(string? reason) => new()
        {
            BankTransactionId = transaction.Id,
            Splits =
            [
                new AllocationSplit
                {
                    AccountId = scenario.Account("6070"),
                    GrossAmount = 1150.00m,
                    NoVatReason = reason,
                },
            ],
        };

        var refused = await scenario.Allocation.AllocateAsync(Request(null), scenario.Preparer);
        Assert.False(refused.Succeeded);
        Assert.Contains(refused.Errors, e => e.Code == AllocationErrors.NoVatReasonRequired);

        scenario.Db.ChangeTracker.Clear();
        var accepted = await scenario.Allocation.AllocateAsync(
            Request("Supplier is not a VAT vendor"), scenario.Preparer);
        Assert.True(accepted.Succeeded, string.Join("; ", accepted.Errors.Select(e => e.Message)));
    }

    [Fact]
    public async Task Allocation_into_a_locked_period_is_refused_by_the_ledger()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var transaction = await ImportOneAsync(scenario, "OFFICE SUPPLIES", -1150.00m);

        var period = await scenario.Db.AccountingPeriods.FirstAsync(p => p.EntityId == scenario.EntityId
            && p.StartDate <= transaction.TransactionDate && p.EndDate >= transaction.TransactionDate);
        await scenario.Periods.SetStatusAsync(period.Id, PeriodStatus.HardLocked, "Closed",
            scenario.Administrator);

        scenario.Db.ChangeTracker.Clear();
        var result = await scenario.Allocation.AllocateAsync(new AllocationRequest
        {
            BankTransactionId = transaction.Id,
            Splits =
            [
                new AllocationSplit
                {
                    AccountId = scenario.Account("6070"),
                    GrossAmount = 1150.00m,
                    VatCodeId = await VatCodeIdAsync(scenario, "01"),
                },
            ],
        }, scenario.Preparer);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == PostingErrors.PeriodNotOpen);

        var unallocated = await scenario.Db.BankTransactions.AsNoTracking()
            .FirstAsync(t => t.Id == transaction.Id);
        Assert.Equal(BankTransactionStatus.Unallocated, unallocated.Status);
        Assert.Null(unallocated.JournalId);
    }

    [Fact]
    public async Task Allocation_writes_an_audit_event()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var transaction = await ImportOneAsync(scenario, "OFFICE SUPPLIES", -1150.00m);

        await scenario.Allocation.AllocateAsync(new AllocationRequest
        {
            BankTransactionId = transaction.Id,
            Splits =
            [
                new AllocationSplit
                {
                    AccountId = scenario.Account("6070"),
                    GrossAmount = 1150.00m,
                    VatCodeId = await VatCodeIdAsync(scenario, "01"),
                },
            ],
        }, scenario.Preparer);

        var audit = await scenario.Db.AuditEvents.AsNoTracking()
            .FirstAsync(a => a.RecordId == transaction.Id && a.EventType == "BankTransactionAllocated");

        Assert.Equal("preparer-user", audit.ActorUserId);
        Assert.Contains("OFFICE SUPPLIES", audit.DetailJson);
    }
}
