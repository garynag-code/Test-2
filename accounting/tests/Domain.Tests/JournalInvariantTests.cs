using Accounting.Domain.Entities;
using Accounting.Domain.Enums;
using Xunit;

namespace Domain.Tests;

public class JournalInvariantTests
{
    private static JournalLine Line(decimal debit, decimal credit) =>
        new() { AccountId = Guid.NewGuid(), DebitAmount = debit, CreditAmount = credit };

    [Fact]
    public void Journal_with_equal_debits_and_credits_is_balanced()
    {
        var journal = new Journal { JournalNumber = "GEN-000001" };
        journal.Lines.Add(Line(1000.00m, 0m));
        journal.Lines.Add(Line(0m, 1000.00m));

        Assert.True(journal.IsBalanced);
    }

    [Fact]
    public void Journal_out_by_one_cent_is_not_balanced()
    {
        var journal = new Journal { JournalNumber = "GEN-000002" };
        journal.Lines.Add(Line(1000.00m, 0m));
        journal.Lines.Add(Line(0m, 999.99m));

        Assert.False(journal.IsBalanced);
    }

    [Fact]
    public void Balance_check_is_exact_at_four_decimal_places()
    {
        var journal = new Journal { JournalNumber = "GEN-000003" };
        journal.Lines.Add(Line(0.3333m, 0m));
        journal.Lines.Add(Line(0.3333m, 0m));
        journal.Lines.Add(Line(0.3334m, 0m));
        journal.Lines.Add(Line(0m, 1.0000m));

        Assert.True(journal.IsBalanced);
        Assert.Equal(1.0000m, journal.TotalDebit);
    }

    [Theory]
    [InlineData(100, 0, true)]
    [InlineData(0, 100, true)]
    [InlineData(100, 100, false)]
    [InlineData(0, 0, false)]
    [InlineData(-100, 0, false)]
    [InlineData(0, -100, false)]
    public void Line_carries_an_amount_on_exactly_one_side(decimal debit, decimal credit, bool expected) =>
        Assert.Equal(expected, Line(debit, credit).HasValidSides);

    [Theory]
    [InlineData(AccountType.Asset, NormalBalance.Debit)]
    [InlineData(AccountType.Expense, NormalBalance.Debit)]
    [InlineData(AccountType.Liability, NormalBalance.Credit)]
    [InlineData(AccountType.Equity, NormalBalance.Credit)]
    [InlineData(AccountType.Income, NormalBalance.Credit)]
    public void Normal_balance_follows_account_type(AccountType type, NormalBalance expected) =>
        Assert.Equal(expected, Account.NormalBalanceFor(type));

    [Theory]
    [InlineData(PeriodStatus.Open, true, true)]
    [InlineData(PeriodStatus.SoftLocked, false, true)]
    [InlineData(PeriodStatus.HardLocked, false, false)]
    public void Period_posting_gates_follow_lock_status(PeriodStatus status, bool ordinary, bool elevated)
    {
        var period = new AccountingPeriod { Name = "Mar 2026", Status = status };

        Assert.Equal(ordinary, period.AcceptsOrdinaryPosting);
        Assert.Equal(elevated, period.AcceptsElevatedPosting);
    }

    [Fact]
    public void Period_contains_only_dates_within_its_boundaries()
    {
        var period = new AccountingPeriod
        {
            Name = "Mar 2026",
            StartDate = new DateOnly(2026, 3, 1),
            EndDate = new DateOnly(2026, 3, 31),
        };

        Assert.True(period.Contains(new DateOnly(2026, 3, 1)));
        Assert.True(period.Contains(new DateOnly(2026, 3, 31)));
        Assert.False(period.Contains(new DateOnly(2026, 2, 28)));
        Assert.False(period.Contains(new DateOnly(2026, 4, 1)));
    }

    [Fact]
    public void Monetary_amounts_use_decimal_not_binary_floating_point()
    {
        var journal = new Journal { JournalNumber = "GEN-000004" };
        journal.Lines.Add(Line(0.10m, 0m));
        journal.Lines.Add(Line(0.20m, 0m));
        journal.Lines.Add(Line(0m, 0.30m));

        // The same arithmetic in binary floating point does not balance.
        Assert.True(journal.IsBalanced);
        Assert.NotEqual(0.1d + 0.2d, 0.3d);
    }
}
