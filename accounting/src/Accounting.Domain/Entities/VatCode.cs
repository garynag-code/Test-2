using System.ComponentModel.DataAnnotations;
using Accounting.Domain.Enums;

namespace Accounting.Domain.Entities;

/// <summary>VAT code. Specification section 12.2. Rates live in VatRateHistory so history stays reproducible.</summary>
public class VatCode : IConcurrencyVersioned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EntityId { get; set; }

    [MaxLength(10)] public required string Code { get; set; }
    [MaxLength(100)] public required string Description { get; set; }

    public VatTreatment Treatment { get; set; }
    public VatInputOutputMode InputOutputMode { get; set; } = VatInputOutputMode.Both;
    public bool CapitalFlag { get; set; }

    [MaxLength(20)] public string? Vat201MappingCode { get; set; }

    /// <summary>Recoverable portion of input VAT, 0-100. Specification section 12.3.</summary>
    public decimal RecoverablePercentage { get; set; } = 100m;

    public bool Active { get; set; } = true;

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    [MaxLength(450)] public string? CreatedBy { get; set; }
    public DateTime? UpdatedAtUtc { get; set; }
    [MaxLength(450)] public string? UpdatedBy { get; set; }
    public int Version { get; set; }

    public ICollection<VatRateHistory> RateHistory { get; set; } = [];
}

/// <summary>Effective-dated VAT rate. Specification sections 3 and 12.2.</summary>
public class VatRateHistory
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid VatCodeId { get; set; }
    public VatCode? VatCode { get; set; }

    public decimal RatePercent { get; set; }
    public DateOnly EffectiveFrom { get; set; }
    public DateOnly? EffectiveTo { get; set; }

    [MaxLength(50)] public string? SourceRuleSetVersion { get; set; }
}
