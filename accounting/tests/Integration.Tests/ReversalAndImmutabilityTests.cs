using Accounting.Application.GeneralLedger;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Integration.Tests;

/// <summary>Proves INV-004 and INV-005 and acceptance test GL-AC-002.</summary>
[Collection("database")]
public class ReversalAndImmutabilityTests(DatabaseFixture fixture)
{
    private static readonly DateOnly PostingDate = new(2026, 6, 30);

    [Fact]
    public async Task Reversal_creates_a_linked_opposite_entry_and_leaves_the_original_intact()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var posted = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 1150m, 0m), ("1000", 0m, 1150m)), scenario.Preparer);

        var reversal = await scenario.Posting.ReverseAsync(posted.JournalId!.Value,
            new DateOnly(2026, 7, 15), "Incorrect expense account", scenario.Preparer);

        Assert.True(reversal.Succeeded);
        Assert.StartsWith("REV-", reversal.JournalNumber);

        scenario.Db.ChangeTracker.Clear();
        var original = await scenario.Db.Journals.Include(j => j.Lines)
            .AsNoTracking().FirstAsync(j => j.Id == posted.JournalId);
        var reversing = await scenario.Db.Journals.Include(j => j.Lines)
            .AsNoTracking().FirstAsync(j => j.Id == reversal.JournalId);

        Assert.Equal(JournalStatus.Reversed, original.Status);
        Assert.Equal(reversal.JournalId, original.ReversedByJournalId);
        Assert.Equal(posted.JournalId, reversing.ReversalOfJournalId);
        Assert.Equal(JournalType.REV, reversing.JournalType);
        Assert.Equal("Incorrect expense account", reversing.ReversalReason);

        // The original amounts are untouched and the reversal mirrors them.
        Assert.Equal(1150m, original.TotalDebit);
        Assert.Equal(1150m, reversing.TotalDebit);
        foreach (var line in original.Lines)
        {
            var mirror = reversing.Lines.Single(l => l.AccountId == line.AccountId);
            Assert.Equal(line.DebitAmount, mirror.CreditAmount);
            Assert.Equal(line.CreditAmount, mirror.DebitAmount);
        }
    }

    [Fact]
    public async Task Reversal_clears_the_balance_in_the_trial_balance()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var posted = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 1150m, 0m), ("1000", 0m, 1150m)), scenario.Preparer);

        var from = new DateOnly(2026, 3, 1);
        var to = new DateOnly(2027, 2, 28);

        var before = await scenario.Reporting.GetTrialBalanceAsync(scenario.EntityId, from, to);
        Assert.Equal(1150m, before.Rows.Single(r => r.AccountCode == "6070").ClosingBalance);

        await scenario.Posting.ReverseAsync(posted.JournalId!.Value, new DateOnly(2026, 7, 15),
            "Incorrect expense account", scenario.Preparer);

        var after = await scenario.Reporting.GetTrialBalanceAsync(scenario.EntityId, from, to);
        Assert.Empty(after.Rows.Where(r => r.ClosingBalance != 0m));
        Assert.True(after.IsBalanced);
    }

    [Fact]
    public async Task A_journal_cannot_be_reversed_twice()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var posted = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 100m, 0m), ("1000", 0m, 100m)), scenario.Preparer);
        await scenario.Posting.ReverseAsync(posted.JournalId!.Value, PostingDate, "First", scenario.Preparer);

        scenario.Db.ChangeTracker.Clear();
        var second = await scenario.Posting.ReverseAsync(posted.JournalId.Value, PostingDate,
            "Second", scenario.Preparer);

        Assert.False(second.Succeeded);
        Assert.Contains(second.Errors, e => e.Code == PostingErrors.AlreadyReversed);
    }

    [Fact]
    public async Task Reversal_into_a_locked_period_is_rejected()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var posted = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 100m, 0m), ("1000", 0m, 100m)), scenario.Preparer);

        var julyPeriod = await scenario.Db.AccountingPeriods.FirstAsync(p => p.EntityId == scenario.EntityId
            && p.StartDate <= new DateOnly(2026, 7, 15) && p.EndDate >= new DateOnly(2026, 7, 15));
        await scenario.Periods.SetStatusAsync(julyPeriod.Id, PeriodStatus.HardLocked, "Closed",
            scenario.Administrator);

        scenario.Db.ChangeTracker.Clear();
        var result = await scenario.Posting.ReverseAsync(posted.JournalId!.Value,
            new DateOnly(2026, 7, 15), "Correction", scenario.Preparer);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == PostingErrors.PeriodNotOpen);
    }

    [Fact]
    public async Task Reversal_requires_a_reason()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var posted = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 100m, 0m), ("1000", 0m, 100m)), scenario.Preparer);

        var result = await scenario.Posting.ReverseAsync(posted.JournalId!.Value, PostingDate, "   ",
            scenario.Preparer);

        Assert.False(result.Succeeded);
    }

    /// <summary>GL-AC-002 at the database boundary: a posted journal cannot be edited even through direct SQL.</summary>
    [Fact]
    public async Task Database_rejects_an_update_to_a_posted_journal()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var posted = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 100m, 0m), ("1000", 0m, 100m)), scenario.Preparer);

        var error = await Assert.ThrowsAnyAsync<Exception>(() =>
            scenario.Db.Database.ExecuteSqlRawAsync(
                "UPDATE journals SET description = 'tampered' WHERE id = {0}", posted.JournalId!.Value));

        Assert.Contains("INV-004", Flatten(error));
    }

    [Fact]
    public async Task Database_rejects_a_delete_of_a_posted_journal()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var posted = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 100m, 0m), ("1000", 0m, 100m)), scenario.Preparer);

        var error = await Assert.ThrowsAnyAsync<Exception>(() =>
            scenario.Db.Database.ExecuteSqlRawAsync(
                "DELETE FROM journals WHERE id = {0}", posted.JournalId!.Value));

        Assert.Contains("INV-004", Flatten(error));
    }

    [Fact]
    public async Task Database_rejects_a_change_to_a_posted_journal_line()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var posted = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 100m, 0m), ("1000", 0m, 100m)), scenario.Preparer);

        var error = await Assert.ThrowsAnyAsync<Exception>(() =>
            scenario.Db.Database.ExecuteSqlRawAsync(
                "UPDATE journal_lines SET debit_amount = 999 WHERE journal_id = {0}", posted.JournalId!.Value));

        Assert.Contains("INV-004", Flatten(error));
    }

    /// <summary>INV-001 at the database boundary: a posted journal can never be left unbalanced.</summary>
    [Fact]
    public async Task Database_rejects_an_unbalanced_posted_journal_written_directly()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var periodId = await scenario.Db.AccountingPeriods
            .Where(p => p.EntityId == scenario.EntityId
                && p.StartDate <= PostingDate && p.EndDate >= PostingDate)
            .Select(p => p.Id).FirstAsync();

        var journalId = Guid.NewGuid();
        var error = await Assert.ThrowsAnyAsync<Exception>(async () =>
        {
            await scenario.Db.Database.ExecuteSqlRawAsync("""
                INSERT INTO journals (id, entity_id, journal_number, journal_type, transaction_date,
                    period_id, description, source_module, status, created_at_utc)
                VALUES ({0}, {1}, 'SQL-000001', 'GEN', {2}, {3}, 'direct write', 'GeneralLedger',
                    'Posted', now());
                INSERT INTO journal_lines (id, journal_id, entity_id, line_no, account_id,
                    debit_amount, credit_amount)
                VALUES (gen_random_uuid(), {0}, {1}, 1, {4}, 1000.0000, 0);
                INSERT INTO journal_lines (id, journal_id, entity_id, line_no, account_id,
                    debit_amount, credit_amount)
                VALUES (gen_random_uuid(), {0}, {1}, 2, {5}, 0, 999.9900);
                """, journalId, scenario.EntityId, PostingDate, periodId,
                scenario.Account("6070"), scenario.Account("1000"));
        });

        Assert.Contains("INV-001", Flatten(error));
        scenario.Db.ChangeTracker.Clear();
        Assert.False(await scenario.Db.Journals.AsNoTracking().AnyAsync(j => j.Id == journalId));
    }

    [Fact]
    public async Task Database_rejects_a_line_carrying_both_a_debit_and_a_credit()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var periodId = await scenario.Db.AccountingPeriods
            .Where(p => p.EntityId == scenario.EntityId
                && p.StartDate <= PostingDate && p.EndDate >= PostingDate)
            .Select(p => p.Id).FirstAsync();

        var journalId = Guid.NewGuid();
        var error = await Assert.ThrowsAnyAsync<Exception>(async () =>
        {
            await scenario.Db.Database.ExecuteSqlRawAsync("""
                INSERT INTO journals (id, entity_id, journal_number, journal_type, transaction_date,
                    period_id, source_module, status, created_at_utc)
                VALUES ({0}, {1}, 'SQL-000002', 'GEN', {2}, {3}, 'GeneralLedger', 'Draft', now());
                INSERT INTO journal_lines (id, journal_id, entity_id, line_no, account_id,
                    debit_amount, credit_amount)
                VALUES (gen_random_uuid(), {0}, {1}, 1, {4}, 100.0000, 100.0000);
                """, journalId, scenario.EntityId, PostingDate, periodId, scenario.Account("6070"));
        });

        Assert.Contains("ck_journal_lines_single_side", Flatten(error));
    }

    [Fact]
    public async Task Audit_events_cannot_be_altered_or_removed()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 100m, 0m), ("1000", 0m, 100m)), scenario.Preparer);

        var update = await Assert.ThrowsAnyAsync<Exception>(() =>
            scenario.Db.Database.ExecuteSqlRawAsync(
                "UPDATE audit_events SET event_type = 'x' WHERE entity_id = {0}", scenario.EntityId));
        var delete = await Assert.ThrowsAnyAsync<Exception>(() =>
            scenario.Db.Database.ExecuteSqlRawAsync(
                "DELETE FROM audit_events WHERE entity_id = {0}", scenario.EntityId));

        Assert.Contains("append-only", Flatten(update));
        Assert.Contains("append-only", Flatten(delete));
    }

    [Fact]
    public async Task Draft_journal_can_be_deleted_but_a_posted_one_cannot()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var (draft, created) = await scenario.Drafts.CreateAsync(
            scenario.Journal(PostingDate, ("6070", 100m, 0m), ("1000", 0m, 100m)), scenario.Preparer);
        Assert.True(created.Succeeded);
        Assert.True((await scenario.Drafts.DeleteAsync(draft!.Id, scenario.Preparer)).Succeeded);

        var posted = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 100m, 0m), ("1000", 0m, 100m)), scenario.Preparer);
        var refused = await scenario.Drafts.DeleteAsync(posted.JournalId!.Value, scenario.Preparer);

        Assert.False(refused.Succeeded);
        Assert.Contains(refused.Errors, e => e.Code == PostingErrors.JournalImmutable);
    }

    private static string Flatten(Exception error)
    {
        var text = new System.Text.StringBuilder();
        for (var current = error; current is not null; current = current.InnerException)
            text.Append(current.Message).Append(' ');
        return text.ToString();
    }
}
