using Accounting.Application.GeneralLedger;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Integration.Tests;

/// <summary>Proves accounting invariants INV-001 to INV-005 and acceptance tests GL-AC-001 to GL-AC-003.</summary>
[Collection("database")]
public class PostingServiceTests(DatabaseFixture fixture)
{
    private static readonly DateOnly PostingDate = new(2026, 6, 30);

    [Fact]
    public async Task Balanced_journal_posts_and_is_numbered()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var result = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 1000m, 0m), ("1000", 0m, 1000m)),
            scenario.Preparer);

        Assert.True(result.Succeeded);
        Assert.StartsWith("GEN-", result.JournalNumber);

        var journal = await scenario.Db.Journals.Include(j => j.Lines)
            .AsNoTracking().FirstAsync(j => j.Id == result.JournalId);
        Assert.Equal(JournalStatus.Posted, journal.Status);
        Assert.Equal(1000m, journal.TotalDebit);
        Assert.Equal(journal.TotalDebit, journal.TotalCredit);
        Assert.Equal("preparer-user", journal.PostedBy);
        Assert.NotNull(journal.PostedAtUtc);
    }

    /// <summary>GL-AC-001: debit 1,000 against credit 999.99 is rejected and nothing is written.</summary>
    [Fact]
    public async Task Unbalanced_journal_is_rejected_and_nothing_is_posted()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var result = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 1000.00m, 0m), ("1000", 0m, 999.99m)),
            scenario.Preparer);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == PostingErrors.Unbalanced);
        Assert.False(await scenario.Db.Journals.AnyAsync(j => j.EntityId == scenario.EntityId));
        Assert.False(await scenario.Db.JournalLines.AnyAsync(l => l.EntityId == scenario.EntityId));
    }

    /// <summary>INV-002: header and non-posting accounts reject postings.</summary>
    [Fact]
    public async Task Posting_to_a_non_posting_account_is_rejected()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var header = await scenario.Db.Accounts.FirstAsync(a => a.Id == scenario.Account("6070"));
        header.PostingAllowed = false;
        await scenario.Db.SaveChangesAsync();

        var result = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 100m, 0m), ("1000", 0m, 100m)),
            scenario.Preparer);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == PostingErrors.NonPostingAccount);
    }

    /// <summary>GL-AC-003 and INV-003: a locked period rejects ordinary postings.</summary>
    [Fact]
    public async Task Locked_period_rejects_ordinary_posting_and_accepts_it_again_after_authorised_reopen()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var period = await scenario.Db.AccountingPeriods
            .FirstAsync(p => p.EntityId == scenario.EntityId
                && p.StartDate <= PostingDate && p.EndDate >= PostingDate);

        var locked = await scenario.Periods.SetStatusAsync(period.Id, PeriodStatus.HardLocked,
            "Year-end close", scenario.Administrator);
        Assert.True(locked.Succeeded);

        var rejected = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 100m, 0m), ("1000", 0m, 100m)),
            scenario.Preparer);
        Assert.False(rejected.Succeeded);
        Assert.Contains(rejected.Errors, e => e.Code == PostingErrors.PeriodNotOpen);

        // A preparer may not reopen a locked period.
        var forbidden = await scenario.Periods.SetStatusAsync(period.Id, PeriodStatus.Open,
            "Late invoice", scenario.Preparer);
        Assert.False(forbidden.Succeeded);

        var reopened = await scenario.Periods.SetStatusAsync(period.Id, PeriodStatus.Open,
            "Late invoice received after close", scenario.Administrator);
        Assert.True(reopened.Succeeded);

        var accepted = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 100m, 0m), ("1000", 0m, 100m)),
            scenario.Preparer);
        Assert.True(accepted.Succeeded);

        // The reopen is recorded in the audit trail with actor and reason.
        var reopenEvent = await scenario.Db.AuditEvents.AsNoTracking()
            .FirstAsync(a => a.EntityId == scenario.EntityId && a.EventType == "PeriodReopened");
        Assert.Equal("admin-user", reopenEvent.ActorUserId);
        Assert.Contains("Late invoice received after close", reopenEvent.DetailJson);
    }

    [Fact]
    public async Task Soft_locked_period_accepts_an_elevated_posting_but_not_an_ordinary_one()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var period = await scenario.Db.AccountingPeriods
            .FirstAsync(p => p.EntityId == scenario.EntityId
                && p.StartDate <= PostingDate && p.EndDate >= PostingDate);
        await scenario.Periods.SetStatusAsync(period.Id, PeriodStatus.SoftLocked, "Management review",
            scenario.Administrator);

        var byPreparer = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 50m, 0m), ("1000", 0m, 50m)), scenario.Preparer);
        Assert.False(byPreparer.Succeeded);

        var byAdministrator = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 50m, 0m), ("1000", 0m, 50m)), scenario.Administrator);
        Assert.True(byAdministrator.Succeeded);
    }

    [Fact]
    public async Task Journal_dated_outside_every_period_is_rejected()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var result = await scenario.Posting.PostAsync(
            scenario.Journal(new DateOnly(2019, 1, 15), ("6070", 100m, 0m), ("1000", 0m, 100m)),
            scenario.Preparer);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == PostingErrors.NoPeriod);
    }

    /// <summary>SEC-AC-001: knowing the identifiers is not access.</summary>
    [Fact]
    public async Task User_scoped_to_another_entity_cannot_post()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var outsider = scenario.Preparer with { EntityId = Guid.NewGuid() };
        var result = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 100m, 0m), ("1000", 0m, 100m)), outsider);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == PostingErrors.Forbidden);
    }

    [Fact]
    public async Task Read_only_user_cannot_post()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var readOnly = scenario.Preparer with { Roles = [Roles.ReadOnly] };
        var result = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 100m, 0m), ("1000", 0m, 100m)), readOnly);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == PostingErrors.Forbidden);
    }

    [Fact]
    public async Task Amount_beyond_four_decimal_places_is_rejected_rather_than_silently_rounded()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var result = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 100.00001m, 0m), ("1000", 0m, 100.00001m)),
            scenario.Preparer);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == PostingErrors.PrecisionExceeded);
    }

    [Fact]
    public async Task Line_with_both_a_debit_and_a_credit_is_rejected()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var result = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 100m, 100m), ("1000", 0m, 100m), ("4000", 100m, 0m)),
            scenario.Preparer);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == PostingErrors.InvalidLine);
    }

    [Fact]
    public async Task Single_line_journal_is_rejected()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var result = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 0m, 0m)), scenario.Preparer);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == PostingErrors.TooFewLines);
    }

    [Fact]
    public async Task Account_belonging_to_another_entity_cannot_be_used()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        await using var other = await LedgerScenario.CreateAsync(fixture);

        var request = new PostRequest
        {
            EntityId = scenario.EntityId,
            TransactionDate = PostingDate,
            Lines =
            [
                new PostLineRequest { AccountId = other.Account("6070"), DebitAmount = 100m },
                new PostLineRequest { AccountId = scenario.Account("1000"), CreditAmount = 100m },
            ],
        };

        var result = await scenario.Posting.PostAsync(request, scenario.Preparer);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == PostingErrors.WrongEntity);
    }

    /// <summary>Supports INV-007: the same source record cannot post twice.</summary>
    [Fact]
    public async Task Second_posting_of_the_same_source_record_is_rejected()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var sourceId = Guid.NewGuid();

        PostRequest Request() => scenario.Journal(PostingDate, ("6070", 100m, 0m), ("1000", 0m, 100m))
            with { SourceModule = "Banking", SourceRecordId = sourceId };

        Assert.True((await scenario.Posting.PostAsync(Request(), scenario.Preparer)).Succeeded);

        var second = await scenario.Posting.PostAsync(Request(), scenario.Preparer);
        Assert.False(second.Succeeded);
        Assert.Contains(second.Errors, e => e.Code == PostingErrors.DuplicateSource);
    }

    [Fact]
    public async Task Posting_writes_an_audit_event()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var result = await scenario.Posting.PostAsync(
            scenario.Journal(PostingDate, ("6070", 250m, 0m), ("1000", 0m, 250m)), scenario.Preparer);

        var audit = await scenario.Db.AuditEvents.AsNoTracking()
            .FirstAsync(a => a.RecordId == result.JournalId && a.EventType == "JournalPosted");

        Assert.Equal("preparer-user", audit.ActorUserId);
        Assert.Equal(scenario.EntityId, audit.EntityId);
        Assert.Contains(result.JournalNumber!, audit.DetailJson);
    }
}
