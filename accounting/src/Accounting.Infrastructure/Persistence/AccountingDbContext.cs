using Accounting.Application.Abstractions;
using Accounting.Domain.Entities;
using Accounting.Domain.Enums;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using DomainEntity = Accounting.Domain.Entities.Entity;

namespace Accounting.Infrastructure.Persistence;

public class AccountingDbContext(DbContextOptions<AccountingDbContext> options)
    : IdentityDbContext<IdentityUser>(options), IAccountingDbContext
{
    public DbSet<DomainEntity> Entities => Set<DomainEntity>();
    public DbSet<FiscalYear> FiscalYears => Set<FiscalYear>();
    public DbSet<AccountingPeriod> AccountingPeriods => Set<AccountingPeriod>();
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<VatCode> VatCodes => Set<VatCode>();
    public DbSet<VatRateHistory> VatRateHistories => Set<VatRateHistory>();
    public DbSet<TaxLine> TaxLines => Set<TaxLine>();
    public DbSet<BankAccount> BankAccounts => Set<BankAccount>();
    public DbSet<BankImportBatch> BankImportBatches => Set<BankImportBatch>();
    public DbSet<BankTransaction> BankTransactions => Set<BankTransaction>();
    public DbSet<AllocationRule> AllocationRules => Set<AllocationRule>();
    public DbSet<BankReconciliation> BankReconciliations => Set<BankReconciliation>();
    public DbSet<BankReconciliationLine> BankReconciliationLines => Set<BankReconciliationLine>();
    public DbSet<Journal> Journals => Set<Journal>();
    public DbSet<JournalLine> JournalLines => Set<JournalLine>();
    public DbSet<EntityUserAccess> EntityUserAccess => Set<EntityUserAccess>();
    public DbSet<JournalNumberSequence> JournalNumberSequences => Set<JournalNumberSequence>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();

    /// <summary>Database schema version reported by System Information (specification section 7.2).</summary>
    public const string AccountingSchemaVersion = "1.0.0";

    /// <summary>Monetary columns, specification section 8.1.</summary>
    private const string Money = "numeric(19,4)";
    private const string Rate = "numeric(19,8)";

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        // PostgreSQL snake_case naming, specification section 8.1.
        foreach (var entityType in b.Model.GetEntityTypes())
        {
            var table = entityType.GetTableName();
            if (table is not null) entityType.SetTableName(ToSnakeCase(table));
            foreach (var property in entityType.GetProperties())
                property.SetColumnName(ToSnakeCase(property.GetColumnName()));
            foreach (var key in entityType.GetKeys())
                key.SetName(ToSnakeCase(key.GetName()!));
            foreach (var fk in entityType.GetForeignKeys())
                fk.SetConstraintName(ToSnakeCase(fk.GetConstraintName()!));
            foreach (var index in entityType.GetIndexes())
                index.SetDatabaseName(ToSnakeCase(index.GetDatabaseName()!));
        }

        b.Entity<DomainEntity>(e =>
        {
            e.ToTable("entities");
            e.HasIndex(x => x.LegalName);
            e.Property(x => x.Version).IsConcurrencyToken();
        });

        b.Entity<FiscalYear>(e =>
        {
            e.HasIndex(x => new { x.EntityId, x.Code }).IsUnique();
            e.HasOne(x => x.Entity).WithMany(x => x.FiscalYears)
                .HasForeignKey(x => x.EntityId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Version).IsConcurrencyToken();
        });

        b.Entity<AccountingPeriod>(e =>
        {
            e.HasIndex(x => new { x.EntityId, x.StartDate, x.EndDate });
            e.HasIndex(x => new { x.FiscalYearId, x.PeriodNumber }).IsUnique();
            e.HasOne(x => x.FiscalYear).WithMany(x => x.Periods)
                .HasForeignKey(x => x.FiscalYearId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Version).IsConcurrencyToken();
        });

        b.Entity<Account>(e =>
        {
            e.HasIndex(x => new { x.EntityId, x.Code }).IsUnique();
            e.HasOne(x => x.Entity).WithMany(x => x.Accounts)
                .HasForeignKey(x => x.EntityId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.DefaultVatCode).WithMany()
                .HasForeignKey(x => x.DefaultVatCodeId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.AccountType).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.NormalBalance).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.ControlAccountType).HasConversion<string>().HasMaxLength(30);
            e.Property(x => x.CurrentNonCurrent).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Version).IsConcurrencyToken();
        });

        b.Entity<VatCode>(e =>
        {
            e.HasIndex(x => new { x.EntityId, x.Code }).IsUnique();
            e.Property(x => x.Treatment).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.InputOutputMode).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.RecoverablePercentage).HasColumnType(Rate);
            e.Property(x => x.Version).IsConcurrencyToken();
        });

        b.Entity<VatRateHistory>(e =>
        {
            e.HasIndex(x => new { x.VatCodeId, x.EffectiveFrom }).IsUnique();
            e.HasOne(x => x.VatCode).WithMany(x => x.RateHistory)
                .HasForeignKey(x => x.VatCodeId).OnDelete(DeleteBehavior.Cascade);
            e.Property(x => x.RatePercent).HasColumnType(Rate);
        });

        b.Entity<TaxLine>(e =>
        {
            e.HasIndex(x => new { x.EntityId, x.TransactionDate });
            e.HasIndex(x => new { x.EntityId, x.Vat201MappingCode });
            e.HasOne(x => x.VatCode).WithMany()
                .HasForeignKey(x => x.VatCodeId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Treatment).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Direction).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.RatePercent).HasColumnType(Rate);
            e.Property(x => x.RecoverablePercentage).HasColumnType(Rate);
            e.Property(x => x.TaxableAmount).HasColumnType(Money);
            e.Property(x => x.VatAmount).HasColumnType(Money);
            e.Property(x => x.RecoverableVatAmount).HasColumnType(Money);
        });

        b.Entity<Journal>(e =>
        {
            e.HasIndex(x => new { x.EntityId, x.JournalNumber }).IsUnique();
            e.HasIndex(x => new { x.EntityId, x.TransactionDate });
            e.HasIndex(x => new { x.EntityId, x.SourceModule, x.SourceRecordId })
                .IsUnique()
                .HasFilter("source_record_id IS NOT NULL");
            e.HasOne(x => x.Period).WithMany()
                .HasForeignKey(x => x.PeriodId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Journal>().WithMany()
                .HasForeignKey(x => x.ReversalOfJournalId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.JournalType).HasConversion<string>().HasMaxLength(10);
        });

        b.Entity<JournalLine>(e =>
        {
            e.HasIndex(x => new { x.EntityId, x.AccountId });
            e.HasIndex(x => new { x.JournalId, x.LineNo }).IsUnique();
            e.HasOne(x => x.Journal).WithMany(x => x.Lines)
                .HasForeignKey(x => x.JournalId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Account).WithMany()
                .HasForeignKey(x => x.AccountId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.TaxLine).WithMany()
                .HasForeignKey(x => x.TaxLineId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.DebitAmount).HasColumnType(Money);
            e.Property(x => x.CreditAmount).HasColumnType(Money);
            e.Ignore(x => x.SignedAmount);
            e.Ignore(x => x.HasValidSides);
            // A line carries an amount on exactly one side, never negative (specification section 11.1).
            e.ToTable(t => t.HasCheckConstraint("ck_journal_lines_single_side",
                "debit_amount >= 0 AND credit_amount >= 0 AND ((debit_amount > 0) <> (credit_amount > 0))"));
        });

        b.Entity<Journal>().Ignore(x => x.TotalDebit).Ignore(x => x.TotalCredit)
            .Ignore(x => x.IsBalanced).Ignore(x => x.IsPosted);

        b.Entity<BankAccount>(e =>
        {
            e.HasIndex(x => new { x.EntityId, x.Name }).IsUnique();
            e.HasOne(x => x.LedgerAccount).WithMany()
                .HasForeignKey(x => x.LedgerAccountId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Version).IsConcurrencyToken();
        });

        b.Entity<BankImportBatch>(e =>
        {
            e.HasIndex(x => new { x.BankAccountId, x.FileHash });
            e.HasIndex(x => new { x.EntityId, x.ImportedAtUtc });
            e.HasOne(x => x.BankAccount).WithMany()
                .HasForeignKey(x => x.BankAccountId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
        });

        b.Entity<BankTransaction>(e =>
        {
            e.HasIndex(x => new { x.BankAccountId, x.TransactionDate });
            e.HasIndex(x => new { x.EntityId, x.Status });
            // INV-007: a bank line reaches the ledger at most once.
            e.HasIndex(x => x.JournalId).IsUnique().HasFilter("journal_id IS NOT NULL");
            e.HasOne(x => x.ImportBatch).WithMany(x => x.Transactions)
                .HasForeignKey(x => x.ImportBatchId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Amount).HasColumnType(Money);
            e.Property(x => x.StatementBalance).HasColumnType(Money);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
        });

        b.Entity<AllocationRule>(e =>
        {
            e.HasIndex(x => new { x.EntityId, x.Sequence });
            e.HasIndex(x => new { x.EntityId, x.Name }).IsUnique();
            e.HasOne(x => x.Account).WithMany()
                .HasForeignKey(x => x.AccountId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.VatCode).WithMany()
                .HasForeignKey(x => x.VatCodeId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.MatchType).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.Ignore(x => x.IsSuggestible);
        });

        b.Entity<BankReconciliation>(e =>
        {
            e.HasIndex(x => new { x.BankAccountId, x.StatementDate });
            e.HasOne(x => x.BankAccount).WithMany()
                .HasForeignKey(x => x.BankAccountId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.StatementBalance).HasColumnType(Money);
            e.Property(x => x.FinalLedgerBalance).HasColumnType(Money);
            e.Property(x => x.FinalUnallocatedTotal).HasColumnType(Money);
            e.Property(x => x.FinalOutstandingTotal).HasColumnType(Money);
            e.Property(x => x.FinalUnexplainedDifference).HasColumnType(Money);
        });

        b.Entity<BankReconciliationLine>(e =>
        {
            e.HasIndex(x => new { x.ReconciliationId, x.JournalLineId }).IsUnique();
            e.HasOne(x => x.Reconciliation).WithMany(x => x.Lines)
                .HasForeignKey(x => x.ReconciliationId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.JournalLine).WithMany()
                .HasForeignKey(x => x.JournalLineId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Amount).HasColumnType(Money);
        });

        b.Entity<EntityUserAccess>(e =>
        {
            e.HasIndex(x => new { x.EntityId, x.UserId, x.Role }).IsUnique();
            e.HasOne(x => x.Entity).WithMany()
                .HasForeignKey(x => x.EntityId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<JournalNumberSequence>(e =>
            e.HasIndex(x => new { x.EntityId, x.Prefix }).IsUnique());

        b.Entity<AuditEvent>(e =>
        {
            e.HasIndex(x => new { x.EntityId, x.OccurredAtUtc });
            e.HasIndex(x => new { x.RecordType, x.RecordId });
            e.Property(x => x.DetailJson).HasColumnType("jsonb");
        });
    }

    /// <summary>Advances optimistic concurrency tokens on edited master and configuration records.</summary>
    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        foreach (var entry in ChangeTracker.Entries<IConcurrencyVersioned>())
            if (entry.State == EntityState.Modified)
                entry.Entity.Version++;

        return base.SaveChangesAsync(ct);
    }

    Task<int> IAccountingDbContext.SaveChangesAsync(CancellationToken ct) => SaveChangesAsync(ct);

    private static string ToSnakeCase(string name)
    {
        var result = new System.Text.StringBuilder(name.Length + 8);
        for (var i = 0; i < name.Length; i++)
        {
            var c = name[i];
            if (char.IsUpper(c))
            {
                if (i > 0 && (!char.IsUpper(name[i - 1]) || (i + 1 < name.Length && char.IsLower(name[i + 1]))))
                    result.Append('_');
                result.Append(char.ToLowerInvariant(c));
            }
            else result.Append(c);
        }
        return result.ToString();
    }
}
