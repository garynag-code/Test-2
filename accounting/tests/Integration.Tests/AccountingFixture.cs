using Accounting.Application.Abstractions;
using Accounting.Application.Banking;
using Accounting.Application.EntitySetup;
using Accounting.Application.GeneralLedger;
using Accounting.Application.Security;
using Accounting.Application.Vat;
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
    public required IVatCalculationService Vat { get; init; }
    public required IBankImportService BankImport { get; init; }
    public required IBankAllocationService Allocation { get; init; }
    public required IAllocationRuleEngine Rules { get; init; }
    public required IBankReconciliationService Reconciliation { get; init; }
    public required Guid BankAccountId { get; init; }
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

        var vat = new VatCalculationService(db);

        var accounts = await db.Accounts.AsNoTracking()
            .Where(a => a.EntityId == entity.Id)
            .ToDictionaryAsync(a => a.Code, a => a.Id);

        // A bank account mapped to the starter chart's bank control account.
        var bankAccount = new Accounting.Domain.Entities.BankAccount
        {
            EntityId = entity.Id,
            Name = "FNB Business Cheque",
            BankKey = "FNB",
            AccountNumber = "62000000000",
            LedgerAccountId = accounts["1000"],
            CreatedAtUtc = clock.UtcNow,
            CreatedBy = admin.UserId,
        };
        db.BankAccounts.Add(bankAccount);
        await db.SaveChangesAsync();

        return new LedgerScenario
        {
            Db = db,
            BankImport = new BankImportService(db, [new FnbCsvStatementParser()], audit, clock),
            Allocation = new BankAllocationService(db, new PostingService(db, audit, vat, clock), vat, audit, clock),
            Rules = new AllocationRuleEngine(db),
            Reconciliation = new BankReconciliationService(db, audit, clock),
            BankAccountId = bankAccount.Id,
            Posting = new PostingService(db, audit, vat, clock),
            Vat = vat,
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
