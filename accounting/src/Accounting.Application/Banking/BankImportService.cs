using System.Security.Cryptography;
using System.Text;
using Accounting.Application.Abstractions;
using Accounting.Application.Security;
using Accounting.Domain.Entities;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Accounting.Application.Banking;

public sealed record ImportPreviewLine(
    ParsedStatementLine Line,
    int DuplicateOrdinal,
    bool IsDuplicate,
    string? DuplicateReason);

public sealed record ImportPreview
{
    public required Guid BankAccountId { get; init; }
    public required string FileHash { get; init; }
    public required string ParserKey { get; init; }
    public IReadOnlyList<ImportPreviewLine> Lines { get; init; } = [];
    public IReadOnlyList<StatementParseError> Errors { get; init; } = [];
    public IReadOnlyList<StatementParseError> Warnings { get; init; } = [];

    /// <summary>Set when this exact file has been imported to this account before (BNK-AC-001).</summary>
    public bool FileAlreadyImported { get; init; }
    public DateTime? PreviouslyImportedAtUtc { get; init; }

    public int NewCount => Lines.Count(l => !l.IsDuplicate);
    public int DuplicateCount => Lines.Count(l => l.IsDuplicate);
    public bool CanCommit => Errors.Count == 0 && NewCount > 0;
}

public sealed record ImportResult(
    bool Succeeded,
    Guid? BatchId,
    int ImportedCount,
    int DuplicateCount,
    IReadOnlyList<StatementParseError> Errors)
{
    public static ImportResult Fail(params StatementParseError[] errors) =>
        new(false, null, 0, 0, errors);
}

public interface IBankImportService
{
    /// <summary>Parses a file and reports what would be imported, without writing anything.</summary>
    Task<ImportPreview> PreviewAsync(Guid bankAccountId, string fileName, Stream content,
        UserContext user, CancellationToken ct = default);

    /// <summary>Commits an import, skipping lines already held for this bank account.</summary>
    Task<ImportResult> CommitAsync(Guid bankAccountId, string fileName, Stream content,
        UserContext user, bool allowReimportOfSameFile = false, CancellationToken ct = default);
}

/// <summary>
/// Statement import. Bank data never reaches the ledger here: imported lines are held as
/// <see cref="BankTransaction"/> until they are allocated and posted through the posting service
/// (specification section 5.4).
/// </summary>
public sealed class BankImportService(
    IAccountingDbContext db,
    IEnumerable<IBankStatementParser> parsers,
    IAuditEventWriter audit,
    IClock clock) : IBankImportService
{
    public async Task<ImportPreview> PreviewAsync(Guid bankAccountId, string fileName, Stream content,
        UserContext user, CancellationToken ct = default)
    {
        var (bankAccount, text, hash, error) = await ReadAsync(bankAccountId, content, user, ct);
        if (error is not null)
            return new ImportPreview
            {
                BankAccountId = bankAccountId,
                FileHash = hash ?? string.Empty,
                ParserKey = string.Empty,
                Errors = [error],
            };

        var parser = SelectParser(bankAccount!.BankKey, fileName, text!);
        if (parser is null)
            return new ImportPreview
            {
                BankAccountId = bankAccountId,
                FileHash = hash!,
                ParserKey = string.Empty,
                Errors =
                [
                    new StatementParseError(null, StatementParseErrors.UnrecognisedFormat,
                        $"No parser recognised this file as a {bankAccount.BankKey} statement."),
                ],
            };

        var parsed = parser.Parse(fileName, text!);
        if (parsed.Errors.Count > 0)
            return new ImportPreview
            {
                BankAccountId = bankAccountId,
                FileHash = hash!,
                ParserKey = parsed.ParserKey,
                Errors = parsed.Errors,
                Warnings = parsed.Warnings,
            };

        var previousImport = await db.BankImportBatches.AsNoTracking()
            .Where(b => b.BankAccountId == bankAccountId && b.FileHash == hash
                && b.Status == BankImportStatus.Committed)
            .OrderByDescending(b => b.ImportedAtUtc)
            .FirstOrDefaultAsync(ct);

        var lines = await MarkDuplicatesAsync(bankAccountId, parsed.Lines, ct);

        return new ImportPreview
        {
            BankAccountId = bankAccountId,
            FileHash = hash!,
            ParserKey = parsed.ParserKey,
            Lines = lines,
            Warnings = parsed.Warnings,
            FileAlreadyImported = previousImport is not null,
            PreviouslyImportedAtUtc = previousImport?.ImportedAtUtc,
        };
    }

    public async Task<ImportResult> CommitAsync(Guid bankAccountId, string fileName, Stream content,
        UserContext user, bool allowReimportOfSameFile = false, CancellationToken ct = default)
    {
        var preview = await PreviewAsync(bankAccountId, fileName, content, user, ct);

        if (preview.Errors.Count > 0)
            return ImportResult.Fail([.. preview.Errors]);

        // BNK-AC-001: a re-import of the identical file is stopped before anything is written.
        if (preview.FileAlreadyImported && !allowReimportOfSameFile)
            return ImportResult.Fail(new StatementParseError(null, "BNK.FILE_ALREADY_IMPORTED",
                $"This file was already imported on {preview.PreviouslyImportedAtUtc:yyyy-MM-dd HH:mm} UTC. " +
                "Confirm the re-import if the lines are genuinely new."));

        if (preview.NewCount == 0)
            return ImportResult.Fail(new StatementParseError(null, "BNK.NOTHING_NEW",
                "Every line in this file has already been imported for this bank account."));

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var parsedFrom = preview.Lines.Min(l => l.Line.TransactionDate);
        var parsedTo = preview.Lines.Max(l => l.Line.TransactionDate);

        var batch = new BankImportBatch
        {
            EntityId = user.EntityId,
            BankAccountId = bankAccountId,
            SourceFileName = fileName,
            FileHash = preview.FileHash,
            ParserKey = preview.ParserKey,
            StatementFrom = parsedFrom,
            StatementTo = parsedTo,
            RowCount = preview.Lines.Count,
            ImportedCount = preview.NewCount,
            DuplicateCount = preview.DuplicateCount,
            Status = BankImportStatus.Committed,
            ImportedBy = user.UserId,
            ImportedAtUtc = clock.UtcNow,
        };
        db.BankImportBatches.Add(batch);

        foreach (var line in preview.Lines.Where(l => !l.IsDuplicate))
        {
            db.BankTransactions.Add(new BankTransaction
            {
                EntityId = user.EntityId,
                BankAccountId = bankAccountId,
                ImportBatchId = batch.Id,
                TransactionDate = line.Line.TransactionDate,
                Amount = line.Line.Amount,
                StatementBalance = line.Line.Balance,
                Description = line.Line.Description,
                Detail = line.Line.Detail,
                SourceRowNumber = line.Line.RowNumber,
                DuplicateOrdinal = line.DuplicateOrdinal,
                Status = BankTransactionStatus.Unallocated,
                CreatedAtUtc = clock.UtcNow,
            });
        }

        audit.Append("BankImportCommitted", user.EntityId, nameof(BankImportBatch), batch.Id, user, new
        {
            batch.SourceFileName,
            batch.FileHash,
            batch.ParserKey,
            BankAccountId = bankAccountId,
            batch.RowCount,
            batch.ImportedCount,
            batch.DuplicateCount,
            From = parsedFrom,
            To = parsedTo,
        });

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        return new ImportResult(true, batch.Id, batch.ImportedCount, batch.DuplicateCount, []);
    }

    /// <summary>
    /// Flags lines already held for this bank account. Identical transactions are counted rather than
    /// matched one to one: a statement legitimately contains two identical purchases on one day, and
    /// discarding the second would understate the bank. Only as many as are already held count as
    /// duplicates; any beyond that are new (BNK-AC-002).
    /// </summary>
    private async Task<List<ImportPreviewLine>> MarkDuplicatesAsync(Guid bankAccountId,
        IReadOnlyList<ParsedStatementLine> lines, CancellationToken ct)
    {
        var from = lines.Min(l => l.TransactionDate);
        var to = lines.Max(l => l.TransactionDate);

        var existing = await db.BankTransactions.AsNoTracking()
            .Where(t => t.BankAccountId == bankAccountId
                && t.TransactionDate >= from && t.TransactionDate <= to)
            .Select(t => new { t.TransactionDate, t.Amount, t.Description, t.StatementBalance })
            .ToListAsync(ct);

        var existingCounts = existing
            .GroupBy(t => NaturalKey(t.TransactionDate, t.Amount, t.Description, t.StatementBalance))
            .ToDictionary(g => g.Key, g => g.Count());

        var seen = new Dictionary<string, int>();
        var result = new List<ImportPreviewLine>(lines.Count);

        foreach (var line in lines)
        {
            var key = NaturalKey(line.TransactionDate, line.Amount, line.Description, line.Balance);
            var ordinal = seen.TryGetValue(key, out var count) ? count : 0;
            seen[key] = ordinal + 1;

            var alreadyHeld = existingCounts.GetValueOrDefault(key);
            var isDuplicate = ordinal < alreadyHeld;

            result.Add(new ImportPreviewLine(line, ordinal, isDuplicate,
                isDuplicate
                    ? $"Already imported for this bank account on {line.TransactionDate:yyyy-MM-dd}."
                    : null));
        }

        return result;
    }

    /// <summary>
    /// Identity of a statement line. The running balance is included where the format supplies one,
    /// because it distinguishes otherwise identical transactions.
    /// </summary>
    private static string NaturalKey(DateOnly date, decimal amount, string description, decimal? balance) =>
        $"{date:yyyy-MM-dd}|{amount:0.0000}|{description.Trim().ToUpperInvariant()}|{balance?.ToString("0.0000") ?? "-"}";

    private IBankStatementParser? SelectParser(string bankKey, string fileName, string content) =>
        parsers.FirstOrDefault(p =>
            p.BankKey.Equals(bankKey, StringComparison.OrdinalIgnoreCase) && p.CanParse(fileName, content));

    private async Task<(BankAccount? Account, string? Text, string? Hash, StatementParseError? Error)>
        ReadAsync(Guid bankAccountId, Stream content, UserContext user, CancellationToken ct)
    {
        var bankAccount = await db.BankAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == bankAccountId, ct);

        if (bankAccount is null)
            return (null, null, null,
                new StatementParseError(null, "BNK.ACCOUNT_NOT_FOUND", "Bank account not found."));
        if (bankAccount.EntityId != user.EntityId)
            return (null, null, null,
                new StatementParseError(null, "BNK.FORBIDDEN", "User has no access to this entity."));
        if (!user.CanPost)
            return (null, null, null,
                new StatementParseError(null, "BNK.FORBIDDEN", "User is not permitted to import statements."));

        using var buffer = new MemoryStream();
        await content.CopyToAsync(buffer, ct);
        var bytes = buffer.ToArray();

        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        return (bankAccount, Encoding.UTF8.GetString(bytes), hash, null);
    }
}
