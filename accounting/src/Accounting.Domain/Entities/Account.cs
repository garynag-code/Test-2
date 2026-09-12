using System.ComponentModel.DataAnnotations;
using Accounting.Domain.Enums;

namespace Accounting.Domain.Entities;

/// <summary>Chart of accounts entry. Specification section 10.3.</summary>
public class Account : IConcurrencyVersioned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EntityId { get; set; }
    public Entity? Entity { get; set; }

    [MaxLength(20)] public required string Code { get; set; }
    [MaxLength(200)] public required string Name { get; set; }

    public AccountType AccountType { get; set; }
    [MaxLength(50)] public string? AccountSubtype { get; set; }
    public NormalBalance NormalBalance { get; set; }

    /// <summary>Header accounts are non-posting. Specification INV-002.</summary>
    public bool PostingAllowed { get; set; } = true;

    public CurrentNonCurrent CurrentNonCurrent { get; set; } = CurrentNonCurrent.NotApplicable;
    [MaxLength(50)] public string? CashflowClassification { get; set; }

    public Guid? DefaultVatCodeId { get; set; }
    public VatCode? DefaultVatCode { get; set; }

    [MaxLength(50)] public string? DefaultFsMappingHint { get; set; }
    public ControlAccountType ControlAccountType { get; set; } = ControlAccountType.None;

    public bool Active { get; set; } = true;
    public DateOnly? OpenedDate { get; set; }
    public DateOnly? ClosedDate { get; set; }

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    [MaxLength(450)] public string? CreatedBy { get; set; }
    public DateTime? UpdatedAtUtc { get; set; }
    [MaxLength(450)] public string? UpdatedBy { get; set; }
    public int Version { get; set; }

    /// <summary>Normal balance implied by account type, used when seeding and validating.</summary>
    public static NormalBalance NormalBalanceFor(AccountType type) => type switch
    {
        AccountType.Asset or AccountType.Expense => NormalBalance.Debit,
        _ => NormalBalance.Credit,
    };
}
