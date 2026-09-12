using Accounting.Application.GeneralLedger;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Integration.Tests;

/// <summary>Trial balance and ledger enquiry derive only from posted journal lines (specification sections 4 and 17).</summary>
[Collection("database")]
public class TrialBalanceTests(DatabaseFixture fixture)
{
    private static readonly DateOnly YearStart = new(2026, 3, 1);
    private static readonly DateOnly YearEnd = new(2027, 2, 28);

    [Fact]
    public async Task Trial_balance_balances_and_reflects_posted_movement_only()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        await scenario.Posting.PostAsync(
            scenario.Journal(new DateOnly(2026, 4, 10), ("1000", 5000m, 0m), ("4000", 0m, 5000m)),
            scenario.Preparer);
        await scenario.Posting.PostAsync(
            scenario.Journal(new DateOnly(2026, 5, 12), ("6080", 1200m, 0m), ("1000", 0m, 1200m)),
            scenario.Preparer);

        // A draft must not appear in any ledger report.
        await scenario.Drafts.CreateAsync(
            scenario.Journal(new DateOnly(2026, 5, 20), ("6070", 999m, 0m), ("1000", 0m, 999m)),
            scenario.Preparer);

        var tb = await scenario.Reporting.GetTrialBalanceAsync(scenario.EntityId, YearStart, YearEnd);

        Assert.True(tb.IsBalanced);
        Assert.Equal(3800m, tb.Rows.Single(r => r.AccountCode == "1000").ClosingBalance);
        Assert.Equal(-5000m, tb.Rows.Single(r => r.AccountCode == "4000").ClosingBalance);
        Assert.Equal(5000m, tb.Rows.Single(r => r.AccountCode == "4000").ClosingCredit);
        Assert.Equal(1200m, tb.Rows.Single(r => r.AccountCode == "6080").ClosingBalance);
        Assert.DoesNotContain(tb.Rows, r => r.AccountCode == "6070");
        Assert.Equal(tb.TotalDebit, tb.TotalCredit);
    }

    [Fact]
    public async Task Opening_balance_carries_prior_period_movement_into_the_selected_range()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        await scenario.Posting.PostAsync(
            scenario.Journal(new DateOnly(2026, 4, 10), ("1000", 5000m, 0m), ("3000", 0m, 5000m)),
            scenario.Preparer);
        await scenario.Posting.PostAsync(
            scenario.Journal(new DateOnly(2026, 9, 10), ("6080", 700m, 0m), ("1000", 0m, 700m)),
            scenario.Preparer);

        var tb = await scenario.Reporting.GetTrialBalanceAsync(scenario.EntityId,
            new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30));

        var bank = tb.Rows.Single(r => r.AccountCode == "1000");
        Assert.Equal(5000m, bank.OpeningBalance);
        Assert.Equal(0m, bank.PeriodDebit);
        Assert.Equal(700m, bank.PeriodCredit);
        Assert.Equal(4300m, bank.ClosingBalance);
        Assert.True(tb.IsBalanced);
    }

    [Fact]
    public async Task Trial_balance_excludes_transactions_after_the_reporting_date()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        await scenario.Posting.PostAsync(
            scenario.Journal(new DateOnly(2026, 4, 10), ("1000", 1000m, 0m), ("4000", 0m, 1000m)),
            scenario.Preparer);
        await scenario.Posting.PostAsync(
            scenario.Journal(new DateOnly(2026, 12, 10), ("1000", 400m, 0m), ("4000", 0m, 400m)),
            scenario.Preparer);

        var tb = await scenario.Reporting.GetTrialBalanceAsync(scenario.EntityId,
            YearStart, new DateOnly(2026, 6, 30));

        Assert.Equal(1000m, tb.Rows.Single(r => r.AccountCode == "1000").ClosingBalance);
    }

    [Fact]
    public async Task Account_activity_shows_a_running_balance_and_the_originating_source()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        await scenario.Posting.PostAsync(
            scenario.Journal(new DateOnly(2026, 4, 10), ("1000", 5000m, 0m), ("4000", 0m, 5000m)),
            scenario.Preparer);
        await scenario.Posting.PostAsync(
            scenario.Journal(new DateOnly(2026, 5, 12), ("6080", 1200m, 0m), ("1000", 0m, 1200m)),
            scenario.Preparer);

        var activity = await scenario.Reporting.GetAccountActivityAsync(scenario.EntityId,
            scenario.Account("1000"), YearStart, YearEnd);

        Assert.Equal(2, activity.Count);
        Assert.Equal(5000m, activity[0].RunningBalance);
        Assert.Equal(3800m, activity[1].RunningBalance);
        Assert.All(activity, line => Assert.Equal("GeneralLedger", line.SourceModule));
        Assert.All(activity, line => Assert.Equal(JournalStatus.Posted, line.JournalStatus));
    }

    [Fact]
    public async Task Trial_balance_is_scoped_to_one_entity()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        await using var other = await LedgerScenario.CreateAsync(fixture);

        await scenario.Posting.PostAsync(
            scenario.Journal(new DateOnly(2026, 4, 10), ("1000", 5000m, 0m), ("4000", 0m, 5000m)),
            scenario.Preparer);

        var otherTb = await other.Reporting.GetTrialBalanceAsync(other.EntityId, YearStart, YearEnd);
        Assert.Empty(otherTb.Rows);
    }
}
