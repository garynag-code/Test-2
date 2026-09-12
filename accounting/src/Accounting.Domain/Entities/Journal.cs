using System.ComponentModel.DataAnnotations;
using Accounting.Domain.Enums;

namespace Accounting.Domain.Entities;

/// <summary>Journal header. Specification section 11.1.</summary>
public class Journal
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EntityId { get; set; }

    [MaxLength(30)] public required string JournalNumber { get; set; }
    public JournalType JournalType { get; set; } = JournalType.GEN;

    public DateOnly TransactionDate { get; set; }
    public Guid PeriodId { get; set; }
    public AccountingPeriod? Period { get; set; }

    [MaxLength(500)] public string? Description { get; set; }
    [MaxLength(100)] public string? Reference { get; set; }

    /// <summary>Originating module, so bank and future subledger journals stay traceable (INV-006).</summary>
    [MaxLength(50)] public string SourceModule { get; set; } = "GeneralLedger";
    public Guid? SourceRecordId { get; set; }

    public JournalStatus Status { get; set; } = JournalStatus.Draft;

    [MaxLength(450)] public string? CreatedBy { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    [MaxLength(450)] public string? ReviewedBy { get; set; }
    public DateTime? ReviewedAtUtc { get; set; }
    [MaxLength(450)] public string? PostedBy { get; set; }
    public DateTime? PostedAtUtc { get; set; }

    /// <summary>Set on a reversal journal, pointing at the journal it reverses (INV-005).</summary>
    public Guid? ReversalOfJournalId { get; set; }
    /// <summary>Set on the original journal once it has been reversed.</summary>
    public Guid? ReversedByJournalId { get; set; }
    [MaxLength(500)] public string? ReversalReason { get; set; }

    public ICollection<JournalLine> Lines { get; set; } = [];

    public decimal TotalDebit => Lines.Sum(l => l.DebitAmount);
    public decimal TotalCredit => Lines.Sum(l => l.CreditAmount);

    /// <summary>INV-001: a posted journal must balance exactly in the entity base currency.</summary>
    public bool IsBalanced => TotalDebit == TotalCredit;

    public bool IsPosted => Status is JournalStatus.Posted or JournalStatus.Reversed;
}

/// <summary>Journal line. Specification section 11.1.</summary>
public class JournalLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JournalId { get; set; }
    public Journal? Journal { get; set; }

    /// <summary>Denormalised for entity-scoped querying and authorisation checks.</summary>
    public Guid EntityId { get; set; }

    public int LineNo { get; set; }

    public Guid AccountId { get; set; }
    public Account? Account { get; set; }

    public decimal DebitAmount { get; set; }
    public decimal CreditAmount { get; set; }

    [MaxLength(500)] public string? Description { get; set; }
    [MaxLength(100)] public string? Reference { get; set; }

    public Guid? DocumentLinkId { get; set; }

    /// <summary>VAT treatment of this line, where one applies. Specification section 11.1.</summary>
    public Guid? TaxLineId { get; set; }
    public TaxLine? TaxLine { get; set; }

    /// <summary>Signed movement in the account, debit positive.</summary>
    public decimal SignedAmount => DebitAmount - CreditAmount;

    /// <summary>A line carries an amount on exactly one side and never a negative amount.</summary>
    public bool HasValidSides =>
        DebitAmount >= 0m && CreditAmount >= 0m &&
        (DebitAmount > 0m ^ CreditAmount > 0m);
}
