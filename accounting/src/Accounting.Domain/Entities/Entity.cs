using System.ComponentModel.DataAnnotations;

namespace Accounting.Domain.Entities;

/// <summary>
/// A client company / accounting entity. Specification section 10.1.
/// Every entity-owned record carries this identifier.
/// </summary>
public class Entity : IConcurrencyVersioned
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [MaxLength(200)] public required string LegalName { get; set; }
    [MaxLength(200)] public string? TradingName { get; set; }
    [MaxLength(50)] public string? RegistrationNumber { get; set; }
    [MaxLength(50)] public string? EntityTypeCode { get; set; }

    /// <summary>Financial year end, stored as month/day. Specification section 10.1.</summary>
    public int FinancialYearEndMonth { get; set; } = 2;
    public int FinancialYearEndDay { get; set; } = 28;

    [MaxLength(3)] public string BaseCurrencyCode { get; set; } = "ZAR";

    public bool IsVatVendor { get; set; }
    [MaxLength(20)] public string? VatNumber { get; set; }
    [MaxLength(20)] public string? IncomeTaxNumber { get; set; }

    /// <summary>Financial reporting framework and version. Specification section 3.</summary>
    [MaxLength(50)] public string ReportingFramework { get; set; } = "IFRS for SMEs";
    [MaxLength(20)] public string ReportingFrameworkVersion { get; set; } = "2015";

    public bool Active { get; set; } = true;

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    [MaxLength(450)] public string? CreatedBy { get; set; }
    public DateTime? UpdatedAtUtc { get; set; }
    [MaxLength(450)] public string? UpdatedBy { get; set; }
    public int Version { get; set; }

    public ICollection<FiscalYear> FiscalYears { get; set; } = [];
    public ICollection<Account> Accounts { get; set; } = [];
}
