using System.ComponentModel.DataAnnotations;
using Accounting.Domain.Enums;

namespace Accounting.Domain.Entities;

/// <summary>
/// Statement-to-ledger reconciliation for one bank account at a date. Specification section 16.
/// INV-008: a final reconciliation must have zero unexplained difference.
/// </summary>
public class BankReconciliation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EntityId { get; set; }
    public Guid BankAccountId { get; set; }
    public BankAccount? BankAccount { get; set; }

    public DateOnly StatementDate { get; set; }

    /// <summary>Closing balance the bank states, as a ledger-signed figure (positive is money held).</summary>
    public decimal StatementBalance { get; set; }

    public ReconciliationStatus Status { get; set; } = ReconciliationStatus.Draft;

    /// <summary>Figures frozen when the reconciliation is finalised, so the evidence stays reproducible.</summary>
    public decimal? FinalLedgerBalance { get; set; }
    public decimal? FinalUnallocatedTotal { get; set; }
    public decimal? FinalOutstandingTotal { get; set; }
    public decimal? FinalUnexplainedDifference { get; set; }

    [MaxLength(450)] public string? PreparedBy { get; set; }
    public DateTime PreparedAtUtc { get; set; } = DateTime.UtcNow;
    [MaxLength(450)] public string? FinalisedBy { get; set; }
    public DateTime? FinalisedAtUtc { get; set; }

    public ICollection<BankReconciliationLine> Lines { get; set; } = [];
}

/// <summary>
/// A ledger entry on the bank account that the statement has not yet shown — an unpresented payment
/// or a deposit in transit. Explaining it is what allows the difference to reach zero honestly.
/// </summary>
public class BankReconciliationLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ReconciliationId { get; set; }
    public BankReconciliation? Reconciliation { get; set; }

    public Guid JournalLineId { get; set; }
    public JournalLine? JournalLine { get; set; }

    /// <summary>Signed ledger movement, carried so the finalised reconciliation reproduces itself.</summary>
    public decimal Amount { get; set; }

    [MaxLength(500)] public required string Explanation { get; set; }

    [MaxLength(450)] public string? CreatedBy { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}
