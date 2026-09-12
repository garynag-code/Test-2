namespace Accounting.Application.Banking;

/// <summary>One transaction line read from a statement, before any accounting interpretation.</summary>
public sealed record ParsedStatementLine
{
    public required int RowNumber { get; init; }
    public required DateOnly TransactionDate { get; init; }
    /// <summary>Signed as the bank states it: negative is money out.</summary>
    public required decimal Amount { get; init; }
    public decimal? Balance { get; init; }
    public required string Description { get; init; }
    public string? Detail { get; init; }
}

public sealed record StatementParseError(int? RowNumber, string Code, string Message);

public sealed record StatementParseResult
{
    public required string ParserKey { get; init; }
    public IReadOnlyList<ParsedStatementLine> Lines { get; init; } = [];

    /// <summary>Account identifier as printed on the statement, for matching against the bank account.</summary>
    public string? AccountNumberHint { get; init; }
    public string? AccountNameHint { get; init; }
    public decimal? ClosingBalanceHint { get; init; }
    public DateOnly? StatementFrom { get; init; }
    public DateOnly? StatementTo { get; init; }

    /// <summary>Problems that prevent the file being used at all.</summary>
    public IReadOnlyList<StatementParseError> Errors { get; init; } = [];
    /// <summary>Problems a reviewer should see but which do not stop an import.</summary>
    public IReadOnlyList<StatementParseError> Warnings { get; init; } = [];

    public bool Succeeded => Errors.Count == 0 && Lines.Count > 0;
}

/// <summary>Specification section 28.3. One implementation per bank and file format.</summary>
public interface IBankStatementParser
{
    /// <summary>Bank this parser reads, matching <c>BankAccount.BankKey</c>.</summary>
    string BankKey { get; }
    /// <summary>Format key, for example "CSV" or "PDF".</summary>
    string Format { get; }
    string ParserKey => $"{BankKey}-{Format}";

    /// <summary>Whether this parser recognises the file, judged from its content rather than its name.</summary>
    bool CanParse(string fileName, string content);

    StatementParseResult Parse(string fileName, string content);
}

public static class StatementParseErrors
{
    public const string NoHeader = "BNK.NO_HEADER";
    public const string NoTransactions = "BNK.NO_TRANSACTIONS";
    public const string BadDate = "BNK.BAD_DATE";
    public const string BadAmount = "BNK.BAD_AMOUNT";
    public const string BalanceChainBroken = "BNK.BALANCE_CHAIN_BROKEN";
    public const string UnrecognisedFormat = "BNK.UNRECOGNISED_FORMAT";
}
