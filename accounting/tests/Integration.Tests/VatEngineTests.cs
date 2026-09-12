using Accounting.Application.GeneralLedger;
using Accounting.Application.Vat;
using Accounting.Domain.Entities;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Integration.Tests;

/// <summary>VAT engine behaviour against real data. Specification section 12.</summary>
[Collection("database")]
public class VatEngineTests(DatabaseFixture fixture)
{
    private static readonly DateOnly PostingDate = new(2026, 6, 30);

    private static async Task<Guid> VatCodeIdAsync(LedgerScenario scenario, string code) =>
        await scenario.Db.VatCodes.AsNoTracking()
            .Where(v => v.EntityId == scenario.EntityId && v.Code == code)
            .Select(v => v.Id).FirstAsync();

    /// <summary>VAT-AC-001 through the service, resolving the rate from history by date.</summary>
    [Fact]
    public async Task Standard_rated_expense_calculates_net_and_vat()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var standard = await VatCodeIdAsync(scenario, "01");

        var result = await scenario.Vat.CalculateAsync(scenario.EntityId, standard, 1150m,
            amountIncludesVat: true, PostingDate);

        Assert.True(result.Succeeded);
        var calculation = result.Calculation!;
        Assert.Equal(15m, calculation.RatePercent);
        Assert.Equal(1000.00m, calculation.TaxableAmount);
        Assert.Equal(150.00m, calculation.VatAmount);
        Assert.Equal(1150.00m, calculation.GrossAmount);
        Assert.Equal(150.00m, calculation.RecoverableVatAmount);
    }

    /// <summary>VAT-AC-002: both calculate zero tax but report to distinct classifications.</summary>
    [Fact]
    public async Task Exempt_and_zero_rated_both_calculate_no_vat_but_stay_distinct()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var exempt = (await scenario.Vat.CalculateAsync(scenario.EntityId,
            await VatCodeIdAsync(scenario, "00"), 1000m, false, PostingDate)).Calculation!;
        var zeroRated = (await scenario.Vat.CalculateAsync(scenario.EntityId,
            await VatCodeIdAsync(scenario, "03"), 1000m, false, PostingDate)).Calculation!;

        Assert.Equal(0m, exempt.VatAmount);
        Assert.Equal(0m, zeroRated.VatAmount);
        Assert.Equal(1000m, exempt.TaxableAmount);
        Assert.Equal(1000m, zeroRated.TaxableAmount);

        Assert.Equal(VatTreatment.Exempt, exempt.Treatment);
        Assert.Equal(VatTreatment.Zero, zeroRated.Treatment);
        Assert.NotEqual(exempt.Vat201MappingCode, zeroRated.Vat201MappingCode);
    }

    /// <summary>The transaction date picks the rate, so a rate change never restates a prior period.</summary>
    [Fact]
    public async Task Rate_is_resolved_from_the_transaction_date()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var standardId = await VatCodeIdAsync(scenario, "01");

        // Close the current rate and add a later one, as a rate change would.
        var current = await scenario.Db.VatRateHistories.FirstAsync(r => r.VatCodeId == standardId);
        current.EffectiveTo = new DateOnly(2026, 8, 31);
        scenario.Db.VatRateHistories.Add(new VatRateHistory
        {
            VatCodeId = standardId,
            RatePercent = 16m,
            EffectiveFrom = new DateOnly(2026, 9, 1),
            SourceRuleSetVersion = "ZA-VAT-TEST",
        });
        await scenario.Db.SaveChangesAsync();

        var before = await scenario.Vat.ResolveRateAsync(standardId, new DateOnly(2026, 8, 31));
        var after = await scenario.Vat.ResolveRateAsync(standardId, new DateOnly(2026, 9, 1));
        var beforeAnyRate = await scenario.Vat.ResolveRateAsync(standardId, new DateOnly(2017, 1, 1));

        Assert.Equal(15m, before);
        Assert.Equal(16m, after);
        Assert.Null(beforeAnyRate);
    }

    [Fact]
    public async Task Calculation_is_refused_when_no_rate_is_effective_on_the_date()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var result = await scenario.Vat.CalculateAsync(scenario.EntityId,
            await VatCodeIdAsync(scenario, "01"), 1000m, false, new DateOnly(2017, 1, 1));

        Assert.False(result.Succeeded);
        Assert.Equal(VatErrors.NoEffectiveRate, result.ErrorCode);
    }

    [Fact]
    public async Task Vat_code_from_another_entity_is_refused()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        await using var other = await LedgerScenario.CreateAsync(fixture);

        var result = await scenario.Vat.CalculateAsync(scenario.EntityId,
            await VatCodeIdAsync(other, "01"), 1000m, false, PostingDate);

        Assert.False(result.Succeeded);
        Assert.Equal(VatErrors.WrongEntity, result.ErrorCode);
    }

    /// <summary>The specification's section 12.4 example, posted through the ledger.</summary>
    [Fact]
    public async Task Vat_inclusive_payment_posts_net_expense_vat_input_and_bank()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var standard = await VatCodeIdAsync(scenario, "01");

        var result = await scenario.Posting.PostAsync(new PostRequest
        {
            EntityId = scenario.EntityId,
            TransactionDate = PostingDate,
            Description = "Office expenses paid from bank",
            Lines =
            [
                new PostLineRequest
                {
                    AccountId = scenario.Account("6070"),
                    DebitAmount = 1000.00m,
                    VatCodeId = standard,
                    VatAmount = 150.00m,
                },
                new PostLineRequest { AccountId = scenario.Account("2100"), DebitAmount = 150.00m },
                new PostLineRequest { AccountId = scenario.Account("1000"), CreditAmount = 1150.00m },
            ],
        }, scenario.Preparer);

        Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Message)));

        var taxLine = await scenario.Db.TaxLines.AsNoTracking()
            .FirstAsync(t => t.EntityId == scenario.EntityId);

        Assert.Equal("01", taxLine.VatCodeSnapshot);
        Assert.Equal(15m, taxLine.RatePercent);
        Assert.Equal(1000.00m, taxLine.TaxableAmount);
        Assert.Equal(150.00m, taxLine.VatAmount);
        Assert.Equal(VatDirection.Input, taxLine.Direction);
        Assert.Equal(PostingDate, taxLine.TransactionDate);

        var line = await scenario.Db.JournalLines.AsNoTracking()
            .FirstAsync(l => l.JournalId == result.JournalId && l.AccountId == scenario.Account("6070"));
        Assert.Equal(taxLine.Id, line.TaxLineId);
    }

    /// <summary>A caller cannot post a VAT amount the rate does not support.</summary>
    [Fact]
    public async Task Vat_amount_that_disagrees_with_the_rate_is_rejected()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var standard = await VatCodeIdAsync(scenario, "01");

        var result = await scenario.Posting.PostAsync(new PostRequest
        {
            EntityId = scenario.EntityId,
            TransactionDate = PostingDate,
            Lines =
            [
                new PostLineRequest
                {
                    AccountId = scenario.Account("6070"),
                    DebitAmount = 1000.00m,
                    VatCodeId = standard,
                    VatAmount = 200.00m, // not 15% of 1,000
                },
                new PostLineRequest { AccountId = scenario.Account("2100"), DebitAmount = 200.00m },
                new PostLineRequest { AccountId = scenario.Account("1000"), CreditAmount = 1200.00m },
            ],
        }, scenario.Preparer);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == PostingErrors.VatMismatch);
        Assert.False(await scenario.Db.TaxLines.AnyAsync(t => t.EntityId == scenario.EntityId));
    }

    [Fact]
    public async Task Vat_code_cannot_be_applied_to_the_vat_control_account()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var standard = await VatCodeIdAsync(scenario, "01");

        var result = await scenario.Posting.PostAsync(new PostRequest
        {
            EntityId = scenario.EntityId,
            TransactionDate = PostingDate,
            Lines =
            [
                new PostLineRequest
                {
                    AccountId = scenario.Account("2100"),
                    DebitAmount = 150.00m,
                    VatCodeId = standard,
                },
                new PostLineRequest { AccountId = scenario.Account("1000"), CreditAmount = 150.00m },
            ],
        }, scenario.Preparer);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == PostingErrors.VatOnControlAccount);
    }

    /// <summary>
    /// A manual journal to a taxable-default account posts without VAT and without ceremony.
    /// The no-VAT override rule of section 12.3 applies to allocation, not to the ledger.
    /// </summary>
    [Fact]
    public async Task Manual_journal_to_a_taxable_account_posts_without_a_vat_code()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var result = await scenario.Posting.PostAsync(new PostRequest
        {
            EntityId = scenario.EntityId,
            TransactionDate = PostingDate,
            JournalType = JournalType.YE,
            Description = "Accrual for office expenses",
            Lines =
            [
                new PostLineRequest { AccountId = scenario.Account("6070"), DebitAmount = 500.00m },
                new PostLineRequest { AccountId = scenario.Account("2200"), CreditAmount = 500.00m },
            ],
        }, scenario.Preparer);

        Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Message)));
        Assert.False(await scenario.Db.TaxLines.AnyAsync(t => t.EntityId == scenario.EntityId));
    }

    /// <summary>A reversal must undo the original exactly, even across a rate change.</summary>
    [Fact]
    public async Task Reversal_keeps_the_original_rate_when_the_rate_has_since_changed()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var standardId = await VatCodeIdAsync(scenario, "01");

        var posted = await scenario.Posting.PostAsync(new PostRequest
        {
            EntityId = scenario.EntityId,
            TransactionDate = PostingDate,
            Lines =
            [
                new PostLineRequest
                {
                    AccountId = scenario.Account("6070"),
                    DebitAmount = 1000.00m,
                    VatCodeId = standardId,
                },
                new PostLineRequest { AccountId = scenario.Account("2100"), DebitAmount = 150.00m },
                new PostLineRequest { AccountId = scenario.Account("1000"), CreditAmount = 1150.00m },
            ],
        }, scenario.Preparer);
        Assert.True(posted.Succeeded, string.Join("; ", posted.Errors.Select(e => e.Message)));

        // The rate changes before the reversal is captured.
        var current = await scenario.Db.VatRateHistories.FirstAsync(r => r.VatCodeId == standardId);
        current.EffectiveTo = new DateOnly(2026, 6, 30);
        scenario.Db.VatRateHistories.Add(new VatRateHistory
        {
            VatCodeId = standardId,
            RatePercent = 16m,
            EffectiveFrom = new DateOnly(2026, 7, 1),
            SourceRuleSetVersion = "ZA-VAT-TEST",
        });
        await scenario.Db.SaveChangesAsync();
        scenario.Db.ChangeTracker.Clear();

        var reversal = await scenario.Posting.ReverseAsync(posted.JournalId!.Value,
            new DateOnly(2026, 7, 31), "Incorrect supplier", scenario.Preparer);

        Assert.True(reversal.Succeeded, string.Join("; ", reversal.Errors.Select(e => e.Message)));

        var reversingTaxLine = await scenario.Db.TaxLines.AsNoTracking()
            .Where(t => t.EntityId == scenario.EntityId)
            .OrderByDescending(t => t.CreatedAtUtc)
            .FirstAsync();

        Assert.Equal(15m, reversingTaxLine.RatePercent);
        Assert.Equal(150.00m, reversingTaxLine.VatAmount);
        Assert.Equal(PostingDate, reversingTaxLine.TransactionDate);
        Assert.Equal(VatDirection.Input, reversingTaxLine.Direction);
    }

    [Fact]
    public async Task Partly_recoverable_code_records_the_recoverable_portion()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var code = await scenario.Db.VatCodes.FirstAsync(v => v.EntityId == scenario.EntityId && v.Code == "01");
        code.RecoverablePercentage = 50m;
        await scenario.Db.SaveChangesAsync();

        var result = await scenario.Vat.CalculateAsync(scenario.EntityId, code.Id, 1000m, false, PostingDate);

        var calculation = result.Calculation!;
        Assert.Equal(150.00m, calculation.VatAmount);
        Assert.Equal(75.00m, calculation.RecoverableVatAmount);
        Assert.Equal(75.00m, calculation.IrrecoverableVatAmount);
    }
}
