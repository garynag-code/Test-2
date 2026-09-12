using Accounting.Application.EntitySetup;
using Accounting.Application.GeneralLedger;
using Accounting.Domain.Enums;
using Xunit;

namespace Application.Tests;

public class TrialBalancePresentationTests
{
    private static TrialBalanceRow Row(string code, AccountType type, decimal closing) =>
        new(Guid.NewGuid(), code, code, type, 0m, closing > 0 ? closing : 0m,
            closing < 0 ? -closing : 0m, closing);

    [Fact]
    public void Debit_and_credit_columns_split_the_closing_balance_by_sign()
    {
        var debitRow = Row("6070", AccountType.Expense, 1500m);
        var creditRow = Row("4000", AccountType.Income, -1500m);

        Assert.Equal(1500m, debitRow.ClosingDebit);
        Assert.Equal(0m, debitRow.ClosingCredit);
        Assert.Equal(0m, creditRow.ClosingDebit);
        Assert.Equal(1500m, creditRow.ClosingCredit);
    }

    [Fact]
    public void Trial_balance_totals_agree_when_every_posting_is_balanced()
    {
        var tb = new TrialBalance(Guid.NewGuid(), new DateOnly(2026, 3, 1), new DateOnly(2027, 2, 28),
            [Row("6070", AccountType.Expense, 1500m), Row("4000", AccountType.Income, -1500m)]);

        Assert.Equal(1500m, tb.TotalDebit);
        Assert.Equal(1500m, tb.TotalCredit);
        Assert.True(tb.IsBalanced);
    }
}

public class StarterDataTests
{
    [Fact]
    public void Starter_chart_has_unique_codes_covering_every_account_type()
    {
        var codes = StarterChartOfAccounts.Accounts.Select(a => a.Code).ToList();
        Assert.Equal(codes.Count, codes.Distinct().Count());

        foreach (var type in Enum.GetValues<AccountType>())
            Assert.Contains(StarterChartOfAccounts.Accounts, a => a.AccountType == type);
    }

    [Fact]
    public void Every_starter_account_references_a_seeded_vat_code()
    {
        var vatCodes = StarterVatCodes.Codes.Select(v => v.Code).ToHashSet();
        Assert.All(StarterChartOfAccounts.Accounts, a => Assert.Contains(a.DefaultVatCode, vatCodes));
    }

    [Fact]
    public void Exempt_and_zero_rated_are_distinct_classifications_at_the_same_zero_rate()
    {
        var exempt = StarterVatCodes.Codes.Single(v => v.Code == "00");
        var zeroRated = StarterVatCodes.Codes.Single(v => v.Code == "03");

        Assert.Equal(0m, exempt.RatePercent);
        Assert.Equal(0m, zeroRated.RatePercent);
        Assert.NotEqual(exempt.Treatment, zeroRated.Treatment);
        Assert.NotEqual(exempt.Vat201MappingCode, zeroRated.Vat201MappingCode);
    }
}

public class PostResultTests
{
    [Fact]
    public void Result_with_errors_never_reports_success()
    {
        var failure = PostResult.Fail(PostingErrors.Unbalanced, "out of balance");

        Assert.False(failure.Succeeded);
        Assert.Null(failure.JournalId);
        Assert.Equal(PostingErrors.Unbalanced, failure.Errors.Single().Code);
    }
}
