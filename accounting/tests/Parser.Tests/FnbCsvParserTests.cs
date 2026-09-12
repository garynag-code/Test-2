using Accounting.Application.Banking;
using Xunit;

namespace Parser.Tests;

/// <summary>
/// Reading FNB's CSV export. The fixtures reproduce the shape of a real export, with
/// synthetic figures.
/// </summary>
public class FnbCsvParserTests
{
    private static readonly FnbCsvStatementParser Parser = new();

    private static string Fixture(string name)
    {
        var directory = AppContext.BaseDirectory;
        while (directory is not null && !Directory.Exists(Path.Combine(directory, "fixtures")))
            directory = Directory.GetParent(directory)?.FullName;

        return File.ReadAllText(Path.Combine(directory!, "fixtures", "bank-statements", "synthetic", name));
    }

    private static StatementParseResult ParseFixture(string name = "fnb-transaction-history.csv") =>
        Parser.Parse(name, Fixture(name));

    [Fact]
    public void Recognises_an_fnb_transaction_history_export()
    {
        Assert.True(Parser.CanParse("statement.csv", Fixture("fnb-transaction-history.csv")));
        Assert.False(Parser.CanParse("notes.csv", "Dear customer,\nYour statement is attached.\n"));
    }

    [Fact]
    public void Reads_every_transaction_row_and_skips_the_preamble()
    {
        var result = ParseFixture();

        Assert.True(result.Succeeded);
        Assert.Empty(result.Errors);
        Assert.Equal(6, result.Lines.Count);
        Assert.Equal("FNB-CSV", result.ParserKey);
    }

    [Fact]
    public void Reads_the_account_details_from_the_preamble()
    {
        var result = ParseFixture();

        Assert.Equal("62000000000", result.AccountNumberHint);
        Assert.Equal("SYNTHETIC TEST ACCOUNT", result.AccountNameHint);
        Assert.Equal(4150.00m, result.ClosingBalanceHint);
    }

    [Fact]
    public void Reads_dates_with_the_year_the_export_supplies()
    {
        var result = ParseFixture();

        Assert.Equal(new DateOnly(2026, 9, 1), result.StatementFrom);
        Assert.Equal(new DateOnly(2026, 9, 10), result.StatementTo);
        Assert.Equal(new DateOnly(2026, 9, 10), result.Lines[0].TransactionDate);
    }

    /// <summary>Money out is negative and money in positive, exactly as the bank states it.</summary>
    [Fact]
    public void Keeps_the_sign_the_bank_states()
    {
        var result = ParseFixture();

        var payment = result.Lines.Single(l => l.Description.Contains("OFFICE SUPPLIES"));
        var deposit = result.Lines.Single(l => l.Description.Contains("CUSTOMER DEPOSIT"));

        Assert.Equal(-1150.00m, payment.Amount);
        Assert.Equal(11500.00m, deposit.Amount);
    }

    [Fact]
    public void Trims_the_leading_space_the_export_puts_before_a_description()
    {
        var result = ParseFixture();

        Assert.Contains(result.Lines, l => l.Description == "PURCH Zapper1*Winston Par 400568******1885");
        Assert.DoesNotContain(result.Lines, l => l.Description.StartsWith(' '));
    }

    /// <summary>
    /// A statement legitimately contains identical transactions on one day. The parser must return
    /// both, never collapse them.
    /// </summary>
    [Fact]
    public void Keeps_identical_transactions_on_the_same_day_as_separate_lines()
    {
        var result = ParseFixture();

        var identical = result.Lines
            .Where(l => l.Description == "PURCH Zapper1*Winston Par 400568******1885")
            .ToList();

        Assert.Equal(2, identical.Count);
        Assert.All(identical, l => Assert.Equal(-250.00m, l.Amount));
        Assert.All(identical, l => Assert.Equal(new DateOnly(2026, 9, 9), l.TransactionDate));
        // They are distinguishable by their row number and running balance.
        Assert.Equal(2, identical.Select(l => l.RowNumber).Distinct().Count());
        Assert.Equal(2, identical.Select(l => l.Balance).Distinct().Count());
    }

    [Fact]
    public void Running_balances_are_read_and_agree_with_the_amounts()
    {
        var result = ParseFixture();

        Assert.All(result.Lines, l => Assert.NotNull(l.Balance));
        Assert.Empty(result.Warnings);
    }

    /// <summary>A break in the running balance is surfaced rather than silently accepted.</summary>
    [Fact]
    public void Broken_balance_chain_is_reported_as_a_warning()
    {
        const string broken = """
            ACCOUNT TRANSACTION HISTORY,,,
            ,,,
            Date, Amount, Balance, Description
            10 09 2026,-250.00,9999.00,SECOND
            09 09 2026,-250.00,4650.00,FIRST
            """;

        var result = Parser.Parse("broken.csv", broken);

        Assert.True(result.Succeeded);
        Assert.Contains(result.Warnings, w => w.Code == StatementParseErrors.BalanceChainBroken);
    }

    [Fact]
    public void A_file_without_a_header_row_is_refused()
    {
        var result = Parser.Parse("nope.csv", "Some other report,,,\n1,2,3,4\n");

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == StatementParseErrors.NoHeader);
    }

    [Fact]
    public void An_unreadable_row_is_reported_and_does_not_silently_vanish()
    {
        const string bad = """
            ACCOUNT TRANSACTION HISTORY,,,
            Date, Amount, Balance, Description
            09 09 2026,-250.00,4650.00,GOOD ROW
            not a date,-250.00,4400.00,BAD DATE
            09 09 2026,not an amount,4400.00,BAD AMOUNT
            """;

        var result = Parser.Parse("bad.csv", bad);

        Assert.Single(result.Lines);
        Assert.Contains(result.Errors, e => e.Code == StatementParseErrors.BadDate);
        Assert.Contains(result.Errors, e => e.Code == StatementParseErrors.BadAmount);
        Assert.False(result.Succeeded);
    }

    [Fact]
    public void Descriptions_containing_commas_are_read_whole_when_quoted()
    {
        const string quoted = """
            ACCOUNT TRANSACTION HISTORY,,,
            Date, Amount, Balance, Description
            09 09 2026,-250.00,4650.00,"SMITH, JONES AND CO"
            """;

        var result = Parser.Parse("quoted.csv", quoted);

        Assert.Equal("SMITH, JONES AND CO", result.Lines.Single().Description);
    }

    [Theory]
    [InlineData("1 234.56", 1234.56)]
    [InlineData("\"1,234.56\"", 1234.56)]  // a thousands separator must be quoted to survive CSV
    [InlineData("-1234.56", -1234.56)]
    [InlineData("1234.56-", -1234.56)]
    [InlineData("(1234.56)", -1234.56)]
    public void Reads_the_amount_formats_a_statement_may_use(string field, double expected)
    {
        var csv = $"""
            ACCOUNT TRANSACTION HISTORY,,,
            Date, Amount, Balance, Description
            09 09 2026,{field},0.00,TEST
            """;

        var result = Parser.Parse("amounts.csv", csv);

        Assert.Equal((decimal)expected, result.Lines.Single().Amount);
    }
}
