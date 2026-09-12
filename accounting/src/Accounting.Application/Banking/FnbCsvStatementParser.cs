using System.Globalization;

namespace Accounting.Application.Banking;

/// <summary>
/// Reads FNB's "Account Transaction History" CSV export.
///
/// The file opens with a short preamble (title, account holder, account, balance), then a
/// <c>Date, Amount, Balance, Description</c> header and the transaction rows. Dates carry the year
/// and are space separated, amounts are signed with money out negative, and rows are listed newest
/// first. Fields may carry leading spaces and every row ends with a trailing comma.
/// </summary>
public sealed class FnbCsvStatementParser : IBankStatementParser
{
    public string BankKey => "FNB";
    public string Format => "CSV";
    public string ParserKey => $"{BankKey}-{Format}";

    private const string HeaderMarker = "ACCOUNT TRANSACTION HISTORY";

    public bool CanParse(string fileName, string content)
    {
        var head = content.Length > 2000 ? content[..2000] : content;
        return head.Contains(HeaderMarker, StringComparison.OrdinalIgnoreCase)
            || (head.Contains("Date", StringComparison.OrdinalIgnoreCase)
                && head.Contains("Balance", StringComparison.OrdinalIgnoreCase)
                && head.Contains("Description", StringComparison.OrdinalIgnoreCase)
                && fileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase));
    }

    public StatementParseResult Parse(string fileName, string content)
    {
        var errors = new List<StatementParseError>();
        var warnings = new List<StatementParseError>();
        var lines = new List<ParsedStatementLine>();

        var rows = content.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries);

        string? accountNumber = null, accountName = null;
        decimal? closingBalance = null;
        var headerRow = -1;

        for (var i = 0; i < rows.Length; i++)
        {
            var fields = SplitCsv(rows[i]);
            if (fields.Count == 0) continue;

            var first = fields[0].Trim();

            if (first.Equals("Date", StringComparison.OrdinalIgnoreCase)
                && fields.Count >= 4
                && fields[1].Trim().Equals("Amount", StringComparison.OrdinalIgnoreCase))
            {
                headerRow = i;
                break;
            }

            // Preamble fields, each labelled and followed by its value.
            if (first.StartsWith("Account:", StringComparison.OrdinalIgnoreCase) && fields.Count > 1)
                accountNumber = fields[1].Trim();
            else if (first.StartsWith("Name:", StringComparison.OrdinalIgnoreCase) && fields.Count > 1)
                accountName = string.Join(' ', fields.Skip(1).Select(f => f.Trim())).Trim();
            else if (first.StartsWith("Balance:", StringComparison.OrdinalIgnoreCase) && fields.Count > 1
                     && TryParseAmount(fields[1], out var balance))
                closingBalance = balance;
        }

        if (headerRow < 0)
        {
            errors.Add(new StatementParseError(null, StatementParseErrors.NoHeader,
                "The file has no 'Date, Amount, Balance, Description' header row."));
            return new StatementParseResult { ParserKey = ParserKey, Errors = errors };
        }

        for (var i = headerRow + 1; i < rows.Length; i++)
        {
            var rowNumber = i + 1;
            var fields = SplitCsv(rows[i]);
            if (fields.Count < 3 || fields.All(f => string.IsNullOrWhiteSpace(f))) continue;

            if (!TryParseDate(fields[0], out var date))
            {
                errors.Add(new StatementParseError(rowNumber, StatementParseErrors.BadDate,
                    $"Could not read a date from '{fields[0].Trim()}'."));
                continue;
            }

            if (!TryParseAmount(fields[1], out var amount))
            {
                errors.Add(new StatementParseError(rowNumber, StatementParseErrors.BadAmount,
                    $"Could not read an amount from '{fields[1].Trim()}'."));
                continue;
            }

            decimal? balance = TryParseAmount(fields[2], out var rowBalance) ? rowBalance : null;
            var description = fields.Count > 3 ? fields[3].Trim() : string.Empty;

            lines.Add(new ParsedStatementLine
            {
                RowNumber = rowNumber,
                TransactionDate = date,
                Amount = amount,
                Balance = balance,
                Description = description,
            });
        }

        if (lines.Count == 0 && errors.Count == 0)
            errors.Add(new StatementParseError(null, StatementParseErrors.NoTransactions,
                "The file contains no transaction rows."));

        warnings.AddRange(CheckBalanceChain(lines));

        return new StatementParseResult
        {
            ParserKey = ParserKey,
            Lines = lines,
            AccountNumberHint = accountNumber,
            AccountNameHint = accountName,
            ClosingBalanceHint = closingBalance,
            StatementFrom = lines.Count > 0 ? lines.Min(l => l.TransactionDate) : null,
            StatementTo = lines.Count > 0 ? lines.Max(l => l.TransactionDate) : null,
            Errors = errors,
            Warnings = warnings,
        };
    }

    /// <summary>
    /// Each running balance should equal the one before it plus the amount. A break means a row was
    /// misread or the export is incomplete, so it is surfaced for review before anything is posted.
    /// </summary>
    private static List<StatementParseError> CheckBalanceChain(IReadOnlyList<ParsedStatementLine> lines)
    {
        var warnings = new List<StatementParseError>();
        if (lines.Count < 2 || lines.Any(l => l.Balance is null)) return warnings;

        // The export lists newest first, so walk it in the order the transactions happened.
        var chronological = lines.Reverse().ToList();
        for (var i = 1; i < chronological.Count; i++)
        {
            var previous = chronological[i - 1];
            var current = chronological[i];
            var expected = previous.Balance!.Value + current.Amount;

            if (decimal.Round(expected, 2) != decimal.Round(current.Balance!.Value, 2))
            {
                warnings.Add(new StatementParseError(current.RowNumber,
                    StatementParseErrors.BalanceChainBroken,
                    $"Balance {current.Balance:0.00} does not follow from {previous.Balance:0.00} " +
                    $"plus {current.Amount:0.00}."));
                break; // One report is enough; a single bad row breaks every balance after it.
            }
        }

        return warnings;
    }

    private static bool TryParseDate(string field, out DateOnly date)
    {
        var text = field.Trim();
        string[] formats =
        [
            "dd MM yyyy", "d M yyyy",
            "dd/MM/yyyy", "d/M/yyyy",
            "yyyy-MM-dd", "yyyy/MM/dd",
            "dd-MM-yyyy", "d-M-yyyy",
        ];

        return DateOnly.TryParseExact(text, formats, CultureInfo.InvariantCulture,
            DateTimeStyles.None, out date);
    }

    /// <summary>
    /// Reads a monetary field as decimal. Accepts thousands separators and a trailing minus, and
    /// rejects anything else rather than guessing — a misread amount would post a wrong figure.
    /// </summary>
    private static bool TryParseAmount(string field, out decimal amount)
    {
        amount = 0m;
        var text = field.Trim().Replace(" ", string.Empty).Replace("R", string.Empty);
        if (text.Length == 0) return false;

        var negative = false;
        if (text.EndsWith('-'))
        {
            negative = true;
            text = text[..^1];
        }
        else if (text.StartsWith('(') && text.EndsWith(')'))
        {
            negative = true;
            text = text[1..^1];
        }

        if (!decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out amount))
            return false;

        if (negative) amount = -amount;
        return true;
    }

    /// <summary>Splits a CSV row, honouring double-quoted fields that may contain commas.</summary>
    private static List<string> SplitCsv(string row)
    {
        var fields = new List<string>();
        var field = new System.Text.StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < row.Length; i++)
        {
            var c = row[i];

            if (inQuotes)
            {
                if (c == '"')
                {
                    if (i + 1 < row.Length && row[i + 1] == '"') { field.Append('"'); i++; }
                    else inQuotes = false;
                }
                else field.Append(c);
            }
            else if (c == '"') inQuotes = true;
            else if (c == ',') { fields.Add(field.ToString()); field.Clear(); }
            else field.Append(c);
        }

        fields.Add(field.ToString());
        return fields;
    }
}
