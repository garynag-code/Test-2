using System.Text;
using Accounting.Application.Banking;
using Accounting.Application.GeneralLedger;
using Accounting.Domain.Entities;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Integration.Tests;

/// <summary>
/// Statement-to-ledger reconciliation. Specification section 16, INV-008 and REC-AC-001.
/// </summary>
[Collection("database")]
public class BankReconciliationTests(DatabaseFixture fixture)
{
    private static readonly DateOnly StatementDate = new(2026, 9, 30);

    private static Stream Content(string text) => new MemoryStream(Encoding.UTF8.GetBytes(text));

    private static async Task<Guid> VatCodeIdAsync(LedgerScenario scenario, string code) =>
        await scenario.Db.VatCodes.AsNoTracking()
            .Where(v => v.EntityId == scenario.EntityId && v.Code == code)
            .Select(v => v.Id).FirstAsync();

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

    /// <summary>Allocates a bank line with no VAT, to keep the arithmetic of the test obvious.</summary>
    private static async Task AllocateAsync(LedgerScenario scenario, BankTransaction transaction,
        string accountCode = "6100")
    {
        var result = await scenario.Allocation.AllocateAsync(new AllocationRequest
        {
            BankTransactionId = transaction.Id,
            Splits =
            [
                new AllocationSplit
                {
                    AccountId = scenario.Account(accountCode),
                    GrossAmount = Math.Abs(transaction.Amount),
                    NoVatReason = "Not a VAT transaction; keeps this test's arithmetic plain",
                },
            ],
        }, scenario.Preparer);
        Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Message)));
        scenario.Db.ChangeTracker.Clear();
    }

    [Fact]
    public async Task A_fully_allocated_statement_reconciles_to_zero_and_finalises()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var receipt = await ImportOneAsync(scenario, "CUSTOMER DEPOSIT", 10000.00m, "02 09 2026");
        await AllocateAsync(scenario, receipt, "4000");
        var payment = await ImportOneAsync(scenario, "SALARIES", -4000.00m, "25 09 2026");
        await AllocateAsync(scenario, payment);

        var started = await scenario.Reconciliation.StartAsync(scenario.BankAccountId,
            StatementDate, 6000.00m, scenario.Preparer);

        Assert.True(started.Succeeded);
        var view = started.View!;
        Assert.Equal(6000.00m, view.LedgerBalance);
        Assert.Empty(view.UnallocatedBankItems);
        Assert.Empty(view.UnexplainedLedgerItems);
        Assert.Equal(0m, view.UnexplainedDifference);
        Assert.True(view.CanFinalise);

        var finalised = await scenario.Reconciliation.FinaliseAsync(view.ReconciliationId,
            scenario.Preparer);

        Assert.True(finalised.Succeeded);
        Assert.Equal(ReconciliationStatus.Final, finalised.View!.Status);

        var stored = await scenario.Db.BankReconciliations.AsNoTracking()
            .FirstAsync(r => r.Id == view.ReconciliationId);
        Assert.Equal(0m, stored.FinalUnexplainedDifference);
        Assert.Equal(6000.00m, stored.FinalLedgerBalance);
        Assert.Equal("preparer-user", stored.FinalisedBy);
        Assert.NotNull(stored.FinalisedAtUtc);
    }

    /// <summary>
    /// A statement line imported but not allocated is on the bank and not in the ledger. It explains
    /// the difference by itself, so the reconciliation still reaches zero.
    /// </summary>
    [Fact]
    public async Task An_unallocated_statement_line_explains_the_difference()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var allocated = await ImportOneAsync(scenario, "CUSTOMER DEPOSIT", 10000.00m, "02 09 2026");
        await AllocateAsync(scenario, allocated, "4000");
        await ImportOneAsync(scenario, "UNKNOWN DEBIT ORDER", -1500.00m, "20 09 2026");

        var started = await scenario.Reconciliation.StartAsync(scenario.BankAccountId,
            StatementDate, 8500.00m, scenario.Preparer);

        var view = started.View!;
        Assert.Equal(10000.00m, view.LedgerBalance);
        Assert.Single(view.UnallocatedBankItems);
        Assert.Equal(-1500.00m, view.UnallocatedTotal);
        Assert.Equal(8500.00m, view.ExpectedStatementBalance);
        Assert.Equal(0m, view.UnexplainedDifference);
        Assert.True(view.CanFinalise);
    }

    /// <summary>
    /// A ledger entry the bank has not shown — a payment not yet presented — must be explained before
    /// it counts. Until then it is unexplained and blocks finalisation.
    /// </summary>
    [Fact]
    public async Task An_unpresented_ledger_entry_blocks_finalising_until_it_is_explained()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var receipt = await ImportOneAsync(scenario, "CUSTOMER DEPOSIT", 10000.00m, "02 09 2026");
        await AllocateAsync(scenario, receipt, "4000");

        // A manual journal paying a supplier, written but not yet through the bank.
        var manual = await scenario.Posting.PostAsync(new PostRequest
        {
            EntityId = scenario.EntityId,
            TransactionDate = new DateOnly(2026, 9, 29),
            Description = "Cheque 1041 to supplier, not yet presented",
            Lines =
            [
                new PostLineRequest { AccountId = scenario.Account("2000"), DebitAmount = 2500.00m },
                new PostLineRequest { AccountId = scenario.Account("1000"), CreditAmount = 2500.00m },
            ],
        }, scenario.Preparer);
        Assert.True(manual.Succeeded, string.Join("; ", manual.Errors.Select(e => e.Message)));
        scenario.Db.ChangeTracker.Clear();

        var started = await scenario.Reconciliation.StartAsync(scenario.BankAccountId,
            StatementDate, 10000.00m, scenario.Preparer);

        var view = started.View!;
        Assert.Equal(7500.00m, view.LedgerBalance);
        Assert.Single(view.UnexplainedLedgerItems);
        Assert.Equal(2500.00m, view.UnexplainedDifference);
        Assert.False(view.CanFinalise);

        var blocked = await scenario.Reconciliation.FinaliseAsync(view.ReconciliationId,
            scenario.Preparer);
        Assert.False(blocked.Succeeded);
        Assert.Equal(ReconciliationErrors.DifferenceNotZero, blocked.ErrorCode);

        // Explaining it as unpresented brings the reconciliation to zero.
        var bankLineId = view.UnexplainedLedgerItems.Single().Id;
        var explained = await scenario.Reconciliation.ExplainAsync(view.ReconciliationId, bankLineId,
            "Cheque 1041 not presented at 30 September", scenario.Preparer);

        Assert.True(explained.Succeeded);
        Assert.Empty(explained.View!.UnexplainedLedgerItems);
        Assert.Single(explained.View.OutstandingLedgerItems);
        Assert.Equal(-2500.00m, explained.View.OutstandingTotal);
        Assert.Equal(0m, explained.View.UnexplainedDifference);
        Assert.True(explained.View.CanFinalise);

        var finalised = await scenario.Reconciliation.FinaliseAsync(view.ReconciliationId,
            scenario.Preparer);
        Assert.True(finalised.Succeeded);
    }

    /// <summary>REC-AC-001: a difference of a single cent stops finalisation.</summary>
    [Fact]
    public async Task A_difference_of_one_cent_cannot_be_finalised()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var receipt = await ImportOneAsync(scenario, "CUSTOMER DEPOSIT", 10000.00m, "02 09 2026");
        await AllocateAsync(scenario, receipt, "4000");

        var started = await scenario.Reconciliation.StartAsync(scenario.BankAccountId,
            StatementDate, 10000.01m, scenario.Preparer);

        Assert.Equal(0.01m, started.View!.UnexplainedDifference);
        Assert.False(started.View.CanFinalise);

        var result = await scenario.Reconciliation.FinaliseAsync(started.View.ReconciliationId,
            scenario.Preparer);

        Assert.False(result.Succeeded);
        Assert.Equal(ReconciliationErrors.DifferenceNotZero, result.ErrorCode);
        Assert.Contains("0.01", result.Message);

        var stored = await scenario.Db.BankReconciliations.AsNoTracking()
            .FirstAsync(r => r.Id == started.View.ReconciliationId);
        Assert.Equal(ReconciliationStatus.Draft, stored.Status);
    }

    [Fact]
    public async Task Removing_an_explanation_puts_the_difference_back()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var manual = await scenario.Posting.PostAsync(new PostRequest
        {
            EntityId = scenario.EntityId,
            TransactionDate = new DateOnly(2026, 9, 29),
            Description = "Unpresented payment",
            Lines =
            [
                new PostLineRequest { AccountId = scenario.Account("2000"), DebitAmount = 1000.00m },
                new PostLineRequest { AccountId = scenario.Account("1000"), CreditAmount = 1000.00m },
            ],
        }, scenario.Preparer);
        scenario.Db.ChangeTracker.Clear();

        var started = await scenario.Reconciliation.StartAsync(scenario.BankAccountId,
            StatementDate, 0m, scenario.Preparer);
        var lineId = started.View!.UnexplainedLedgerItems.Single().Id;

        await scenario.Reconciliation.ExplainAsync(started.View.ReconciliationId, lineId,
            "Not yet presented", scenario.Preparer);
        var removed = await scenario.Reconciliation.RemoveExplanationAsync(
            started.View.ReconciliationId, lineId, scenario.Preparer);

        Assert.Single(removed.View!.UnexplainedLedgerItems);
        Assert.Equal(1000.00m, removed.View.UnexplainedDifference);
        Assert.False(removed.View.CanFinalise);
    }

    [Fact]
    public async Task A_finalised_reconciliation_cannot_be_changed()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var started = await scenario.Reconciliation.StartAsync(scenario.BankAccountId,
            StatementDate, 0m, scenario.Preparer);
        await scenario.Reconciliation.FinaliseAsync(started.View!.ReconciliationId, scenario.Preparer);

        var again = await scenario.Reconciliation.FinaliseAsync(started.View.ReconciliationId,
            scenario.Preparer);
        var explained = await scenario.Reconciliation.ExplainAsync(started.View.ReconciliationId,
            Guid.NewGuid(), "Too late", scenario.Preparer);

        Assert.Equal(ReconciliationErrors.AlreadyFinal, again.ErrorCode);
        Assert.Equal(ReconciliationErrors.AlreadyFinal, explained.ErrorCode);
    }

    [Fact]
    public async Task Transactions_after_the_statement_date_are_not_part_of_the_reconciliation()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var withinPeriod = await ImportOneAsync(scenario, "IN PERIOD", 5000.00m, "02 09 2026");
        await AllocateAsync(scenario, withinPeriod, "4000");
        var afterPeriod = await ImportOneAsync(scenario, "AFTER PERIOD", 900.00m, "05 10 2026");
        await AllocateAsync(scenario, afterPeriod, "4000");

        var started = await scenario.Reconciliation.StartAsync(scenario.BankAccountId,
            StatementDate, 5000.00m, scenario.Preparer);

        Assert.Equal(5000.00m, started.View!.LedgerBalance);
        Assert.Equal(0m, started.View.UnexplainedDifference);
    }

    [Fact]
    public async Task A_user_from_another_entity_cannot_reconcile()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var outsider = scenario.Preparer with { EntityId = Guid.NewGuid() };

        var result = await scenario.Reconciliation.StartAsync(scenario.BankAccountId,
            StatementDate, 0m, outsider);

        Assert.False(result.Succeeded);
        Assert.Equal(ReconciliationErrors.Forbidden, result.ErrorCode);
    }

    [Fact]
    public async Task Finalising_writes_an_audit_event()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var started = await scenario.Reconciliation.StartAsync(scenario.BankAccountId,
            StatementDate, 0m, scenario.Preparer);
        await scenario.Reconciliation.FinaliseAsync(started.View!.ReconciliationId, scenario.Preparer);

        var audit = await scenario.Db.AuditEvents.AsNoTracking()
            .FirstAsync(a => a.RecordId == started.View.ReconciliationId
                && a.EventType == "BankReconciliationFinalised");

        Assert.Equal("preparer-user", audit.ActorUserId);
    }
}
