using System.Text;
using Accounting.Application.Banking;
using Accounting.Domain.Entities;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Integration.Tests;

/// <summary>Remembered allocations. Specification section 15, AUT-AC-001 and AUT-AC-002.</summary>
[Collection("database")]
public class AllocationRuleTests(DatabaseFixture fixture)
{
    private static Stream Content(string text) => new MemoryStream(Encoding.UTF8.GetBytes(text));

    private static async Task<Guid> VatCodeIdAsync(LedgerScenario scenario, string code) =>
        await scenario.Db.VatCodes.AsNoTracking()
            .Where(v => v.EntityId == scenario.EntityId && v.Code == code)
            .Select(v => v.Id).FirstAsync();

    private static async Task<BankTransaction> ImportOneAsync(LedgerScenario scenario,
        string description, decimal amount = -250.00m)
    {
        var csv = $"""
            ACCOUNT TRANSACTION HISTORY,,,
            Date, Amount, Balance, Description
            08 09 2026,{amount:0.00},0.00,{description}
            """;

        var result = await scenario.BankImport.CommitAsync(scenario.BankAccountId,
            $"{Guid.NewGuid():N}.csv", Content(csv), scenario.Preparer);

        return await scenario.Db.BankTransactions.AsNoTracking()
            .FirstAsync(t => t.ImportBatchId == result.BatchId);
    }

    private static async Task<AllocationRule> AddRuleAsync(LedgerScenario scenario, string name,
        RuleMatchType matchType, string matchText, string accountCode, string? vatCode = "01",
        int sequence = 100)
    {
        var rule = new AllocationRule
        {
            EntityId = scenario.EntityId,
            Name = name,
            Sequence = sequence,
            MatchType = matchType,
            MatchText = matchText,
            AccountId = scenario.Account(accountCode),
            VatCodeId = vatCode is null ? null : await VatCodeIdAsync(scenario, vatCode),
            CreatedBy = scenario.Preparer.UserId,
        };
        scenario.Db.AllocationRules.Add(rule);
        await scenario.Db.SaveChangesAsync();
        scenario.Db.ChangeTracker.Clear();
        return rule;
    }

    /// <summary>AUT-AC-001: VODACOM* suggests Telephone and VAT 01, naming the rule that matched.</summary>
    [Fact]
    public async Task A_wildcard_rule_suggests_the_account_and_vat_code_and_names_itself()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var rule = await AddRuleAsync(scenario, "Vodacom airtime", RuleMatchType.Wildcard,
            "VODACOM*", "6110");

        var transaction = await ImportOneAsync(scenario, "VODACOM PREPAID AIRTIME 0821234567");
        var suggestion = await scenario.Rules.SuggestAsync(transaction);

        Assert.NotNull(suggestion);
        Assert.Equal(rule.Id, suggestion.RuleId);
        Assert.Equal("Vodacom airtime", suggestion.RuleName);
        Assert.Equal("VODACOM*", suggestion.MatchExpression);
        Assert.Equal(RuleMatchType.Wildcard, suggestion.MatchType);
        Assert.Equal(scenario.Account("6110"), suggestion.AccountId);
        Assert.Equal(await VatCodeIdAsync(scenario, "01"), suggestion.VatCodeId);
    }

    [Theory]
    [InlineData(RuleMatchType.Exact, "CHECKERS GILLITTS", "CHECKERS GILLITTS", true)]
    [InlineData(RuleMatchType.Exact, "CHECKERS", "CHECKERS GILLITTS", false)]
    [InlineData(RuleMatchType.Contains, "ZAPPER", "POS Purchase Zapper1*Winston Par", true)]
    [InlineData(RuleMatchType.StartsWith, "POS PURCHASE", "POS Purchase Karri Main", true)]
    [InlineData(RuleMatchType.StartsWith, "KARRI", "POS Purchase Karri Main", false)]
    [InlineData(RuleMatchType.Wildcard, "*NETFLIX*", "POS Purchase Netflix Za", true)]
    [InlineData(RuleMatchType.Wildcard, "FNB App Transfer To ???", "FNB App Transfer To Trn", true)]
    [InlineData(RuleMatchType.Wildcard, "FNB App Transfer To ???", "FNB App Transfer To Transfer", false)]
    public void Match_conditions_behave_as_specified(RuleMatchType matchType, string pattern,
        string description, bool expected) =>
        Assert.Equal(expected, IAllocationRuleEngine.Matches(matchType, pattern, description));

    [Fact]
    public async Task Rules_are_tried_in_sequence_so_a_specific_rule_beats_a_general_one()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        await AddRuleAsync(scenario, "All card purchases", RuleMatchType.StartsWith,
            "POS Purchase", "6070", sequence: 200);
        var specific = await AddRuleAsync(scenario, "Netflix subscription", RuleMatchType.Contains,
            "NETFLIX", "6030", sequence: 10);

        var transaction = await ImportOneAsync(scenario, "POS Purchase Netflix Za");
        var suggestion = await scenario.Rules.SuggestAsync(transaction);

        Assert.Equal(specific.Id, suggestion!.RuleId);
        Assert.Equal(scenario.Account("6030"), suggestion.AccountId);
    }

    [Fact]
    public async Task A_rule_can_be_limited_to_money_in_or_money_out()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var rule = await AddRuleAsync(scenario, "Customer receipts", RuleMatchType.Contains,
            "TRANSFER", "4000");
        var tracked = await scenario.Db.AllocationRules.FirstAsync(r => r.Id == rule.Id);
        tracked.AppliesToMoneyIn = true;
        await scenario.Db.SaveChangesAsync();
        scenario.Db.ChangeTracker.Clear();

        var payment = await ImportOneAsync(scenario, "FNB App Transfer To Trn", -500.00m);
        var receipt = await ImportOneAsync(scenario, "FNB App Transfer From Tagg", 500.00m);

        Assert.Null(await scenario.Rules.SuggestAsync(payment));
        Assert.NotNull(await scenario.Rules.SuggestAsync(receipt));
    }

    /// <summary>AUT-AC-002: a repeatedly overridden rule loses confidence and stops being suggested.</summary>
    [Fact]
    public async Task A_repeatedly_overridden_rule_stops_being_suggested()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var rule = await AddRuleAsync(scenario, "Wrong guess", RuleMatchType.Contains, "KARRI", "6070");

        // Each override costs the rule confidence; four take it below the suggestible threshold.
        for (var i = 0; i < 4; i++)
        {
            var transaction = await ImportOneAsync(scenario, $"POS Purchase Karri Main {i}");
            var result = await scenario.Allocation.AllocateAsync(new AllocationRequest
            {
                BankTransactionId = transaction.Id,
                OverriddenRuleId = rule.Id,
                Splits =
                [
                    new AllocationSplit
                    {
                        AccountId = scenario.Account("6100"),
                        GrossAmount = 250.00m,
                        NoVatReason = "Staff refreshments, no tax invoice",
                    },
                ],
            }, scenario.Preparer);
            Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Message)));
            scenario.Db.ChangeTracker.Clear();
        }

        var overridden = await scenario.Db.AllocationRules.AsNoTracking().FirstAsync(r => r.Id == rule.Id);
        Assert.Equal(4, overridden.TimesOverridden);
        Assert.True(overridden.Confidence < AllocationRule.MinimumSuggestibleConfidence);
        Assert.False(overridden.IsSuggestible);

        // The rule is remembered, but no longer offered.
        var next = await ImportOneAsync(scenario, "POS Purchase Karri Main again");
        Assert.Null(await scenario.Rules.SuggestAsync(next));
        Assert.True(await scenario.Db.AllocationRules.AnyAsync(r => r.Id == rule.Id));
    }

    [Fact]
    public async Task Applying_a_rule_records_the_use_and_keeps_its_confidence()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var rule = await AddRuleAsync(scenario, "Telephone", RuleMatchType.Contains, "VODACOM", "6110");

        var transaction = await ImportOneAsync(scenario, "VODACOM PREPAID AIRTIME");
        var suggestion = await scenario.Rules.SuggestAsync(transaction);

        var result = await scenario.Allocation.AllocateAsync(new AllocationRequest
        {
            BankTransactionId = transaction.Id,
            AppliedRuleId = suggestion!.RuleId,
            Splits =
            [
                new AllocationSplit
                {
                    AccountId = suggestion.AccountId,
                    GrossAmount = 250.00m,
                    VatCodeId = suggestion.VatCodeId,
                },
            ],
        }, scenario.Preparer);

        Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Message)));

        var applied = await scenario.Db.AllocationRules.AsNoTracking().FirstAsync(r => r.Id == rule.Id);
        Assert.Equal(1, applied.TimesApplied);
        Assert.Equal(100, applied.Confidence);
        Assert.NotNull(applied.LastAppliedAtUtc);
    }

    [Fact]
    public async Task A_rule_can_be_tested_against_imported_history()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        await ImportOneAsync(scenario, "POS Purchase Karri Main");
        await ImportOneAsync(scenario, "POS Purchase Karri Main again");
        await ImportOneAsync(scenario, "POS Purchase Checkers Gillitts");

        var rule = await AddRuleAsync(scenario, "Karri", RuleMatchType.Contains, "KARRI", "6070");
        var matches = await scenario.Rules.TestAsync(rule.Id);

        Assert.Equal(2, matches.Count);
        Assert.All(matches, t => Assert.Contains("Karri", t.Description));
    }

    [Fact]
    public async Task A_rule_belonging_to_another_entity_never_matches()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        await using var other = await LedgerScenario.CreateAsync(fixture);

        await AddRuleAsync(other, "Other entity rule", RuleMatchType.Contains, "VODACOM", "6110");

        var transaction = await ImportOneAsync(scenario, "VODACOM PREPAID AIRTIME");
        Assert.Null(await scenario.Rules.SuggestAsync(transaction));
    }
}
