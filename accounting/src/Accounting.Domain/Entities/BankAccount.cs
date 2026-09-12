using System.ComponentModel.DataAnnotations;

namespace Accounting.Domain.Entities;

/// <summary>A bank account belonging to an entity, mapped to its control account in the ledger.</summary>
public class BankAccount : IConcurrencyVersioned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EntityId { get; set; }

    [MaxLength(100)] public required string Name { get; set; }
    /// <summary>Bank identifier used to select a statement parser, for example "FNB".</summary>
    [MaxLength(20)] public required string BankKey { get; set; }

    /// <summary>Stored as supplied; statements from the bank are commonly already masked.</summary>
    [MaxLength(40)] public string? AccountNumber { get; set; }
    [MaxLength(20)] public string? BranchCode { get; set; }
    [MaxLength(3)] public string CurrencyCode { get; set; } = "ZAR";

    /// <summary>The general ledger account this bank account posts to.</summary>
    public Guid LedgerAccountId { get; set; }
    public Account? LedgerAccount { get; set; }

    public bool Active { get; set; } = true;

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    [MaxLength(450)] public string? CreatedBy { get; set; }
    public DateTime? UpdatedAtUtc { get; set; }
    [MaxLength(450)] public string? UpdatedBy { get; set; }
    public int Version { get; set; }
}
