using Accounting.Application.Abstractions;
using Accounting.Application.EntitySetup;
using Accounting.Application.GeneralLedger;
using Accounting.Application.Security;
using Accounting.Domain.Enums;
using Accounting.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Integration.Tests;

/// <summary>
/// Applies migrations once against the integration test database. Tests run against real PostgreSQL
/// because several accounting invariants are enforced by database triggers and constraints.
/// </summary>
public sealed class DatabaseFixture : IAsyncLifetime
{
    public string ConnectionString { get; } =
        Environment.GetEnvironmentVariable("ACCOUNTING_TEST_DB")
        ?? "Host=localhost;Port=5432;Database=accounting_test;Username=accounting;Password=accounting";

    public async Task InitializeAsync()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    public AccountingDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AccountingDbContext>()
            .UseNpgsql(ConnectionString)
            .Options;
        return new AccountingDbContext(options);
    }
}

[CollectionDefinition("database")]
public sealed class DatabaseCollection : ICollectionFixture<DatabaseFixture>;

public sealed class TestClock : IClock
{
    public DateTime UtcNow { get; set; } = new(2026, 6, 30, 12, 0, 0, DateTimeKind.Utc);
    public DateOnly Today => DateOnly.FromDateTime(UtcNow);
}

/// <summary>A provisioned entity with its chart of accounts, ready for posting tests.</summary>
public sealed class LedgerScenario : IAsyncDisposable
{
    public required AccountingDbContext Db { get; init; }
    public required IPostingService Posting { get; init; }
    public required IDraftJournalService Drafts { get; init; }
    public required ITrialBalanceService Reporting { get; init; }
    public required IPeriodService Periods { get; init; }
    public required Guid EntityId { get; init; }
    public required UserContext Preparer { get; init; }
    public required UserContext Administrator { get; init; }
    public required IReadOnlyDictionary<string, Guid> AccountsByCode { get; init; }

    public Guid Account(string code) => AccountsByCode[code];

    public static async Task<LedgerScenario> CreateAsync(DatabaseFixture fixture, int fiscalYearEndingIn = 2027)
    {
        var db = fixture.CreateContext();
        var clock = new TestClock();
        var audit = new AuditEventWriter(db, clock);

        var admin = new UserContext("admin-user", "Firm Administrator", Guid.Empty,
            [Roles.FirmAdmin]);

        var setup = new EntitySetupService(db, audit, clock);
        var entity = await setup.CreateEntityAsync(new CreateEntityRequest
        {
            LegalName = $"Test Entity {Guid.NewGuid():N}"[..30],
            IsVatVendor = true,
            OpeningFiscalYearEndingIn = fiscalYearEndingIn,
        }, admin);

        var accounts = await db.Accounts.AsNoTracking()
            .Where(a => a.EntityId == entity.Id)
            .ToDictionaryAsync(a => a.Code, a => a.Id);

        return new LedgerScenario
        {
            Db = db,
            Posting = new PostingService(db, audit, clock),
            Drafts = new DraftJournalService(db, audit, clock),
            Reporting = new TrialBalanceService(db),
            Periods = new PeriodService(db, audit, clock),
            EntityId = entity.Id,
            Preparer = new UserContext("preparer-user", "Preparer", entity.Id, [Roles.Preparer]),
            Administrator = admin with { EntityId = entity.Id },
            AccountsByCode = accounts,
        };
    }

    public PostRequest Journal(DateOnly date, params (string Code, decimal Debit, decimal Credit)[] lines) => new()
    {
        EntityId = EntityId,
        TransactionDate = date,
        JournalType = JournalType.GEN,
        Description = "Test journal",
        Lines = [.. lines.Select(l => new PostLineRequest
        {
            AccountId = Account(l.Code),
            DebitAmount = l.Debit,
            CreditAmount = l.Credit,
        })],
    };

    public async ValueTask DisposeAsync() => await Db.DisposeAsync();
}
