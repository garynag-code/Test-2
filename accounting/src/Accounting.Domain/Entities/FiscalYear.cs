using System.ComponentModel.DataAnnotations;
using Accounting.Domain.Enums;

namespace Accounting.Domain.Entities;

/// <summary>Financial year boundary for an entity. Specification section 8.2.</summary>
public class FiscalYear : IConcurrencyVersioned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EntityId { get; set; }
    public Entity? Entity { get; set; }

    [MaxLength(20)] public required string Code { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }

    /// <summary>Set once the year has been finalised; blocks reopening without elevated permission.</summary>
    public bool IsClosed { get; set; }

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    [MaxLength(450)] public string? CreatedBy { get; set; }
    public DateTime? UpdatedAtUtc { get; set; }
    [MaxLength(450)] public string? UpdatedBy { get; set; }
    public int Version { get; set; }

    public ICollection<AccountingPeriod> Periods { get; set; } = [];
}
