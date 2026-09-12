using Accounting.Application.GeneralLedger;
using Accounting.Application.Vat;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Integration.Tests;

/// <summary>VAT return-period summary and control-account reconciliation. Specification section 12.3.</summary>
[Collection("database")]
public class VatReturnTests(DatabaseFixture fixture)
{
    private static readonly DateOnly From = new(2026, 6, 1);
    private static readonly DateOnly To = new(2026, 6, 30);
    private static readonly DateOnly PostingDate = new(2026, 6, 15);

    private static async Task<Guid> VatCodeIdAsync(LedgerScenario scenario, string code) =>
        await scenario.Db.VatCodes.AsNoTracking()
            .Where(v => v.EntityId == scenario.EntityId && v.Code == code)
            .Select(v => v.Id).FirstAsync();

    [Fact]
    public async Task Summary_separates_output_and_input_vat_and_reconciles_to_the_control_account()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var standard = await VatCodeIdAsync(scenario, "01");
        var returns = new VatReturnService(scenario.Db);

        // A sale of R11,500 including VAT.
        var sale = await scenario.Posting.PostAsync(new PostRequest
        {
            EntityId = scenario.EntityId,
            TransactionDate = PostingDate,
            Description = "Sale",
            Lines =
            [
                new PostLineRequest { AccountId = scenario.Account("1000"), DebitAmount = 11500.00m },
                new PostLineRequest
                {
                    AccountId = scenario.Account("4000"),
                    CreditAmount = 10000.00m,
                    VatCodeId = standard,
                },
                new PostLineRequest { AccountId = scenario.Account("2100"), CreditAmount = 1500.00m },
            ],
        }, scenario.Preparer);
        Assert.True(sale.Succeeded, string.Join("; ", sale.Errors.Select(e => e.Message)));

        // An expense of R1,150 including VAT.
        var expense = await scenario.Posting.PostAsync(new PostRequest
        {
            EntityId = scenario.EntityId,
            TransactionDate = PostingDate,
            Description = "Office expenses",
            Lines =
            [
                new PostLineRequest
                {
                    AccountId = scenario.Account("6070"),
                    DebitAmount = 1000.00m,
                    VatCodeId = standard,
                },
                new PostLineRequest { AccountId = scenario.Account("2100"), DebitAmount = 150.00m },
                new PostLineRequest { AccountId = scenario.Account("1000"), CreditAmount = 1150.00m },
            ],
        }, scenario.Preparer);
        Assert.True(expense.Succeeded, string.Join("; ", expense.Errors.Select(e => e.Message)));

        var summary = await returns.GetReturnSummaryAsync(scenario.EntityId, From, To);

        Assert.Equal(1500.00m, summary.OutputVat);
        Assert.Equal(150.00m, summary.InputVat);
        Assert.Equal(1350.00m, summary.NetVatPayable);

        // VAT control carries 1,500 credit less 150 debit; the summary must agree with it exactly.
        Assert.Equal(-1350.00m, summary.VatControlAccountBalance);
        Assert.True(summary.Reconciles);
        Assert.Equal(0m, summary.UnreconciledDifference);

        Assert.Contains(summary.Lines, l => l.Direction == VatDirection.Output && l.TaxableAmount == 10000.00m);
        Assert.Contains(summary.Lines, l => l.Direction == VatDirection.Input && l.TaxableAmount == 1000.00m);
    }

    /// <summary>VAT posted to the control account without a tax line must show as unreconciled.</summary>
    [Fact]
    public async Task Vat_posted_without_a_tax_line_is_reported_as_an_unreconciled_difference()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var returns = new VatReturnService(scenario.Db);

        var posted = await scenario.Posting.PostAsync(new PostRequest
        {
            EntityId = scenario.EntityId,
            TransactionDate = PostingDate,
            Description = "VAT posted directly, with no VAT code on the expense",
            Lines =
            [
                new PostLineRequest { AccountId = scenario.Account("6070"), DebitAmount = 1000.00m },
                new PostLineRequest { AccountId = scenario.Account("2100"), DebitAmount = 150.00m },
                new PostLineRequest { AccountId = scenario.Account("1000"), CreditAmount = 1150.00m },
            ],
        }, scenario.Preparer);
        Assert.True(posted.Succeeded, string.Join("; ", posted.Errors.Select(e => e.Message)));

        var summary = await returns.GetReturnSummaryAsync(scenario.EntityId, From, To);

        Assert.Empty(summary.Lines);
        Assert.False(summary.Reconciles);
        Assert.Equal(150.00m, summary.UnreconciledDifference);
    }

    /// <summary>Exempt and zero-rated supplies reach the return under distinct VAT201 classifications.</summary>
    [Fact]
    public async Task Exempt_and_zero_rated_supplies_report_separately()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var returns = new VatReturnService(scenario.Db);

        foreach (var code in new[] { "00", "03" })
        {
            var result = await scenario.Posting.PostAsync(new PostRequest
            {
                EntityId = scenario.EntityId,
                TransactionDate = PostingDate,
                Description = $"Supply under VAT code {code}",
                Lines =
                [
                    new PostLineRequest { AccountId = scenario.Account("1000"), DebitAmount = 2000.00m },
                    new PostLineRequest
                    {
                        AccountId = scenario.Account("4000"),
                        CreditAmount = 2000.00m,
                        VatCodeId = await VatCodeIdAsync(scenario, code),
                    },
                ],
            }, scenario.Preparer);
            Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Message)));
        }

        var summary = await returns.GetReturnSummaryAsync(scenario.EntityId, From, To);

        Assert.Equal(2, summary.Lines.Count);
        Assert.Equal(0m, summary.OutputVat);
        Assert.Single(summary.Lines, l => l.Treatment == VatTreatment.Exempt && l.TaxableAmount == 2000.00m);
        Assert.Single(summary.Lines, l => l.Treatment == VatTreatment.Zero && l.TaxableAmount == 2000.00m);

        // Distinct VAT201 classifications, as required by VAT-AC-002.
        Assert.Equal(2, summary.Lines.Select(l => l.Vat201MappingCode).Distinct().Count());
    }

    [Fact]
    public async Task Summary_excludes_transactions_outside_the_return_period()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var returns = new VatReturnService(scenario.Db);

        var result = await scenario.Posting.PostAsync(new PostRequest
        {
            EntityId = scenario.EntityId,
            TransactionDate = new DateOnly(2026, 7, 15),
            Lines =
            [
                new PostLineRequest { AccountId = scenario.Account("1000"), DebitAmount = 1150.00m },
                new PostLineRequest
                {
                    AccountId = scenario.Account("4000"),
                    CreditAmount = 1000.00m,
                    VatCodeId = await VatCodeIdAsync(scenario, "01"),
                },
                new PostLineRequest { AccountId = scenario.Account("2100"), CreditAmount = 150.00m },
            ],
        }, scenario.Preparer);
        Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Message)));

        var summary = await returns.GetReturnSummaryAsync(scenario.EntityId, From, To);

        Assert.Empty(summary.Lines);
        Assert.Equal(0m, summary.OutputVat);
    }
}
