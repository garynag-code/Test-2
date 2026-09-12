using System.ComponentModel.DataAnnotations;
using Accounting.Domain.Enums;

namespace Accounting.Domain.Entities;

/// <summary>
/// The VAT treatment of one journal line, captured at posting time. Specification section 12.3:
/// the taxable base, VAT amount, rate and code are persisted so the historical calculation stays
/// reproducible even after rates or code definitions change.
/// </summary>
public class TaxLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EntityId { get; set; }

    public Guid VatCodeId { get; set; }
    public VatCode? VatCode { get; set; }

    /// <summary>Snapshot of the code, so a later rename does not rewrite history.</summary>
    [MaxLength(10)] public required string VatCodeSnapshot { get; set; }
    [MaxLength(20)] public string? Vat201MappingCode { get; set; }
    public VatTreatment Treatment { get; set; }

    /// <summary>Rate applied, resolved from the rate history by transaction date.</summary>
    public decimal RatePercent { get; set; }

    public decimal TaxableAmount { get; set; }
    public decimal VatAmount { get; set; }

    /// <summary>Portion of input VAT the entity may recover, per the code's configuration.</summary>
    public decimal RecoverablePercentage { get; set; } = 100m;
    public decimal RecoverableVatAmount { get; set; }

    public VatDirection Direction { get; set; }
    public bool CapitalFlag { get; set; }

    /// <summary>Transaction date that determined the rate.</summary>
    public DateOnly TransactionDate { get; set; }

    /// <summary>Reason recorded when a taxable account is deliberately posted without VAT (section 12.3).</summary>
    [MaxLength(500)] public string? NoVatReason { get; set; }

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}
