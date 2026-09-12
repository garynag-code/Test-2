using Accounting.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;

namespace Accounting.Application.Abstractions;

/// <summary>Persistence surface used by application services. Implemented by Infrastructure (EF Core).</summary>
public interface IAccountingDbContext
{
    DbSet<Entity> Entities { get; }
    DbSet<FiscalYear> FiscalYears { get; }
    DbSet<AccountingPeriod> AccountingPeriods { get; }
    DbSet<Account> Accounts { get; }
    DbSet<VatCode> VatCodes { get; }
    DbSet<VatRateHistory> VatRateHistories { get; }
    DbSet<TaxLine> TaxLines { get; }
    DbSet<BankAccount> BankAccounts { get; }
    DbSet<BankImportBatch> BankImportBatches { get; }
    DbSet<BankTransaction> BankTransactions { get; }
    DbSet<Journal> Journals { get; }
    DbSet<JournalLine> JournalLines { get; }
    DbSet<EntityUserAccess> EntityUserAccess { get; }
    DbSet<JournalNumberSequence> JournalNumberSequences { get; }
    DbSet<AuditEvent> AuditEvents { get; }

    DatabaseFacade Database { get; }
    Task<int> SaveChangesAsync(CancellationToken ct = default);
}
