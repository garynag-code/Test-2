using System.Text;
using Accounting.Application.Banking;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Integration.Tests;

/// <summary>Statement import and duplicate detection. Specification section 14, BNK-AC-001 and BNK-AC-002.</summary>
[Collection("database")]
public class BankImportTests(DatabaseFixture fixture)
{
    private static string FixturePath(string name)
    {
        var directory = AppContext.BaseDirectory;
        while (directory is not null && !Directory.Exists(Path.Combine(directory, "fixtures")))
            directory = Directory.GetParent(directory)?.FullName;

        return Path.Combine(directory!, "fixtures", "bank-statements", "synthetic", name);
    }

    private static Stream Fixture(string name) => File.OpenRead(FixturePath(name));

    private static Stream Content(string text) => new MemoryStream(Encoding.UTF8.GetBytes(text));

    [Fact]
    public async Task Import_reads_every_line_and_keeps_its_source_provenance()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        await using var file = Fixture("fnb-transaction-history.csv");
        var result = await scenario.BankImport.CommitAsync(scenario.BankAccountId,
            "fnb-transaction-history.csv", file, scenario.Preparer);

        Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Message)));
        Assert.Equal(6, result.ImportedCount);

        var batch = await scenario.Db.BankImportBatches.AsNoTracking()
            .FirstAsync(b => b.Id == result.BatchId);

        // INV-006: source batch, file hash and original description are retained.
        Assert.Equal("fnb-transaction-history.csv", batch.SourceFileName);
        Assert.Equal(64, batch.FileHash.Length);
        Assert.Equal("FNB-CSV", batch.ParserKey);
        Assert.Equal(new DateOnly(2026, 9, 1), batch.StatementFrom);
        Assert.Equal(new DateOnly(2026, 9, 10), batch.StatementTo);

        var transactions = await scenario.Db.BankTransactions.AsNoTracking()
            .Where(t => t.ImportBatchId == batch.Id)
            .OrderBy(t => t.TransactionDate)
            .ToListAsync();

        Assert.Equal(6, transactions.Count);
        Assert.All(transactions, t => Assert.Equal(BankTransactionStatus.Unallocated, t.Status));
        Assert.All(transactions, t => Assert.Null(t.JournalId));
        Assert.All(transactions, t => Assert.True(t.SourceRowNumber > 0));
        Assert.Contains(transactions, t => t.Description == "#MONTHLY ACCOUNT FEE");
    }

    /// <summary>Importing does not touch the ledger; allocation does that later.</summary>
    [Fact]
    public async Task Import_writes_no_journals()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        await using var file = Fixture("fnb-transaction-history.csv");
        await scenario.BankImport.CommitAsync(scenario.BankAccountId,
            "fnb-transaction-history.csv", file, scenario.Preparer);

        Assert.False(await scenario.Db.Journals.AnyAsync(j => j.EntityId == scenario.EntityId));
    }

    /// <summary>BNK-AC-001: re-importing the identical file is detected before commit.</summary>
    [Fact]
    public async Task Re_import_of_the_identical_file_is_refused()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        await using (var first = Fixture("fnb-transaction-history.csv"))
            Assert.True((await scenario.BankImport.CommitAsync(scenario.BankAccountId,
                "fnb-transaction-history.csv", first, scenario.Preparer)).Succeeded);

        await using var second = Fixture("fnb-transaction-history.csv");
        var preview = await scenario.BankImport.PreviewAsync(scenario.BankAccountId,
            "fnb-transaction-history.csv", second, scenario.Preparer);

        Assert.True(preview.FileAlreadyImported);
        Assert.NotNull(preview.PreviouslyImportedAtUtc);

        second.Position = 0;
        var result = await scenario.BankImport.CommitAsync(scenario.BankAccountId,
            "fnb-transaction-history.csv", second, scenario.Preparer);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == "BNK.FILE_ALREADY_IMPORTED");
        Assert.Equal(6, await scenario.Db.BankTransactions.CountAsync(t => t.EntityId == scenario.EntityId));
    }

    /// <summary>
    /// BNK-AC-002: an overlapping export is flagged line by line, so only the genuinely new
    /// transactions are imported.
    /// </summary>
    [Fact]
    public async Task Overlapping_export_imports_only_the_new_transactions()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        await using (var first = Fixture("fnb-transaction-history.csv"))
            await scenario.BankImport.CommitAsync(scenario.BankAccountId,
                "fnb-transaction-history.csv", first, scenario.Preparer);

        await using var overlap = Fixture("fnb-transaction-history-overlap.csv");
        var preview = await scenario.BankImport.PreviewAsync(scenario.BankAccountId,
            "fnb-transaction-history-overlap.csv", overlap, scenario.Preparer);

        Assert.False(preview.FileAlreadyImported);
        Assert.Equal(4, preview.Lines.Count);
        Assert.Equal(3, preview.DuplicateCount);
        Assert.Equal(1, preview.NewCount);
        Assert.All(preview.Lines.Where(l => l.IsDuplicate), l => Assert.NotNull(l.DuplicateReason));

        overlap.Position = 0;
        var result = await scenario.BankImport.CommitAsync(scenario.BankAccountId,
            "fnb-transaction-history-overlap.csv", overlap, scenario.Preparer);

        Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Message)));
        Assert.Equal(1, result.ImportedCount);
        Assert.Equal(3, result.DuplicateCount);
        Assert.Equal(7, await scenario.Db.BankTransactions.CountAsync(t => t.EntityId == scenario.EntityId));
    }

    /// <summary>
    /// Two genuinely identical transactions on one day must both survive. Counting occurrences rather
    /// than matching on distinctness is what makes this work.
    /// </summary>
    [Fact]
    public async Task Identical_transactions_on_the_same_day_are_both_imported()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        const string csv = """
            ACCOUNT TRANSACTION HISTORY,,,
            Date, Amount, Balance, Description
            09 09 2026,-250.00,4400.00,PURCH Zapper1*Winston Par
            09 09 2026,-250.00,4650.00,PURCH Zapper1*Winston Par
            """;

        var result = await scenario.BankImport.CommitAsync(scenario.BankAccountId,
            "same-day.csv", Content(csv), scenario.Preparer);

        Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Message)));
        Assert.Equal(2, result.ImportedCount);
        Assert.Equal(0, result.DuplicateCount);

        var imported = await scenario.Db.BankTransactions.AsNoTracking()
            .Where(t => t.EntityId == scenario.EntityId).ToListAsync();
        Assert.Equal(-500.00m, imported.Sum(t => t.Amount));
    }

    /// <summary>
    /// A later statement containing a third identical transaction imports one, not none and not three.
    /// </summary>
    [Fact]
    public async Task A_further_identical_transaction_is_imported_while_the_earlier_ones_are_not()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        const string two = """
            ACCOUNT TRANSACTION HISTORY,,,
            Date, Amount, Balance, Description
            09 09 2026,-250.00,0.00,REPEATING CHARGE
            09 09 2026,-250.00,0.00,REPEATING CHARGE
            """;

        const string three = """
            ACCOUNT TRANSACTION HISTORY,,,
            Date, Amount, Balance, Description
            09 09 2026,-250.00,0.00,REPEATING CHARGE
            09 09 2026,-250.00,0.00,REPEATING CHARGE
            09 09 2026,-250.00,0.00,REPEATING CHARGE
            """;

        await scenario.BankImport.CommitAsync(scenario.BankAccountId, "two.csv",
            Content(two), scenario.Preparer);

        var result = await scenario.BankImport.CommitAsync(scenario.BankAccountId, "three.csv",
            Content(three), scenario.Preparer);

        Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Message)));
        Assert.Equal(1, result.ImportedCount);
        Assert.Equal(2, result.DuplicateCount);
        Assert.Equal(3, await scenario.Db.BankTransactions.CountAsync(t => t.EntityId == scenario.EntityId));
    }

    [Fact]
    public async Task A_file_whose_lines_are_all_already_held_imports_nothing()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        const string csv = """
            ACCOUNT TRANSACTION HISTORY,,,
            Date, Amount, Balance, Description
            09 09 2026,-250.00,4650.00,ONLY LINE
            """;

        await scenario.BankImport.CommitAsync(scenario.BankAccountId, "a.csv",
            Content(csv), scenario.Preparer);

        // A different file name, so the file-hash check does not catch it; the lines still must not repeat.
        var result = await scenario.BankImport.CommitAsync(scenario.BankAccountId, "b.csv",
            Content(csv + "\n"), scenario.Preparer);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == "BNK.NOTHING_NEW");
        Assert.Equal(1, await scenario.Db.BankTransactions.CountAsync(t => t.EntityId == scenario.EntityId));
    }

    [Fact]
    public async Task An_unparseable_file_is_refused_and_writes_nothing()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var result = await scenario.BankImport.CommitAsync(scenario.BankAccountId, "letter.csv",
            Content("Dear customer,\nYour statement is attached.\n"), scenario.Preparer);

        Assert.False(result.Succeeded);
        Assert.False(await scenario.Db.BankImportBatches.AnyAsync(b => b.EntityId == scenario.EntityId));
        Assert.False(await scenario.Db.BankTransactions.AnyAsync(t => t.EntityId == scenario.EntityId));
    }

    [Fact]
    public async Task A_user_from_another_entity_cannot_import()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        await using var file = Fixture("fnb-transaction-history.csv");
        var outsider = scenario.Preparer with { EntityId = Guid.NewGuid() };

        var result = await scenario.BankImport.CommitAsync(scenario.BankAccountId,
            "fnb-transaction-history.csv", file, outsider);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == "BNK.FORBIDDEN");
    }

    [Fact]
    public async Task A_read_only_user_cannot_import()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        await using var file = Fixture("fnb-transaction-history.csv");
        var readOnly = scenario.Preparer with { Roles = [Roles.ReadOnly] };

        var result = await scenario.BankImport.CommitAsync(scenario.BankAccountId,
            "fnb-transaction-history.csv", file, readOnly);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == "BNK.FORBIDDEN");
    }

    [Fact]
    public async Task Import_writes_an_audit_event_naming_the_file_and_its_hash()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        await using var file = Fixture("fnb-transaction-history.csv");
        var result = await scenario.BankImport.CommitAsync(scenario.BankAccountId,
            "fnb-transaction-history.csv", file, scenario.Preparer);

        var audit = await scenario.Db.AuditEvents.AsNoTracking()
            .FirstAsync(a => a.RecordId == result.BatchId && a.EventType == "BankImportCommitted");

        Assert.Equal("preparer-user", audit.ActorUserId);
        Assert.Contains("fnb-transaction-history.csv", audit.DetailJson);
        Assert.Contains("FileHash", audit.DetailJson);
    }
}
