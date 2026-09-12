using System.ComponentModel.DataAnnotations;
using Accounting.Domain.Enums;

namespace Accounting.Domain.Entities;

/// <summary>Accounting period with lock status. Specification sections 8.2, 8.3 and INV-003.</summary>
public class AccountingPeriod : IConcurrencyVersioned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EntityId { get; set; }
    public Guid FiscalYearId { get; set; }
    public FiscalYear? FiscalYear { get; set; }

    public int PeriodNumber { get; set; }
    [MaxLength(50)] public required string Name { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }

    public PeriodStatus Status { get; set; } = PeriodStatus.Open;

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    [MaxLength(450)] public string? CreatedBy { get; set; }
    public DateTime? UpdatedAtUtc { get; set; }
    [MaxLength(450)] public string? UpdatedBy { get; set; }
    public int Version { get; set; }

    public bool Contains(DateOnly date) => date >= StartDate && date <= EndDate;

    /// <summary>
    /// Ordinary postings are accepted only into an open period (INV-003).
    /// Soft locked periods accept postings from users holding elevated permission;
    /// hard locked periods must be reopened through the authorised workflow first.
    /// </summary>
    public bool AcceptsOrdinaryPosting => Status == PeriodStatus.Open;
    public bool AcceptsElevatedPosting => Status is PeriodStatus.Open or PeriodStatus.SoftLocked;
}
