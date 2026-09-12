using Accounting.Domain.Enums;

namespace Accounting.Application.EntitySetup;

public sealed record StarterAccount(
    string Code,
    string Name,
    AccountType AccountType,
    string Subtype,
    string DefaultVatCode,
    CurrentNonCurrent CurrentNonCurrent = CurrentNonCurrent.NotApplicable,
    ControlAccountType ControlAccountType = ControlAccountType.None,
    bool PostingAllowed = true);

/// <summary>
/// Generic starter chart from specification Appendix A. Account codes are user-editable and do not
/// determine reporting treatment; category and mapping metadata do (specification section 10.2).
/// </summary>
public static class StarterChartOfAccounts
{
    public static readonly IReadOnlyList<StarterAccount> Accounts =
    [
        new("1000", "Bank - Current Account", AccountType.Asset, "Current asset", "00", CurrentNonCurrent.Current, ControlAccountType.Bank),
        new("1010", "Petty Cash", AccountType.Asset, "Current asset", "00", CurrentNonCurrent.Current, ControlAccountType.Bank),
        new("1100", "Trade Receivables", AccountType.Asset, "Current asset", "00", CurrentNonCurrent.Current, ControlAccountType.AccountsReceivable),
        new("1200", "Inventory", AccountType.Asset, "Current asset", "00", CurrentNonCurrent.Current),
        new("1300", "Prepayments", AccountType.Asset, "Current asset", "00", CurrentNonCurrent.Current),
        new("1500", "Property, Plant and Equipment - Cost", AccountType.Asset, "Non-current asset", "02", CurrentNonCurrent.NonCurrent),
        new("1510", "Accumulated Depreciation", AccountType.Asset, "Non-current asset", "00", CurrentNonCurrent.NonCurrent),
        new("2000", "Trade Payables", AccountType.Liability, "Current liability", "00", CurrentNonCurrent.Current, ControlAccountType.AccountsPayable),
        new("2100", "VAT Control", AccountType.Liability, "Current liability", "00", CurrentNonCurrent.Current, ControlAccountType.Vat),
        new("2110", "PAYE/UIF/SDL Control", AccountType.Liability, "Current liability", "00", CurrentNonCurrent.Current),
        new("2200", "Accruals", AccountType.Liability, "Current liability", "00", CurrentNonCurrent.Current),
        new("2500", "Loans Payable", AccountType.Liability, "Non-current liability", "00", CurrentNonCurrent.NonCurrent),
        new("3000", "Share Capital / Contributions", AccountType.Equity, "Equity", "00"),
        new("3100", "Retained Income", AccountType.Equity, "Equity", "00"),
        new("4000", "Sales / Revenue", AccountType.Income, "Revenue", "01"),
        new("4100", "Other Operating Revenue", AccountType.Income, "Revenue", "01"),
        new("5000", "Purchases / Cost of Sales", AccountType.Expense, "Cost of sales", "01"),
        new("5100", "Freight and Direct Costs", AccountType.Expense, "Cost of sales", "01"),
        new("6000", "Accounting and Professional Fees", AccountType.Expense, "Operating expense", "01"),
        new("6010", "Advertising and Marketing", AccountType.Expense, "Operating expense", "01"),
        new("6020", "Bank Charges", AccountType.Expense, "Operating expense", "00"),
        new("6030", "Computer / Software", AccountType.Expense, "Operating expense", "01"),
        new("6040", "Depreciation", AccountType.Expense, "Operating expense", "00"),
        new("6050", "Insurance", AccountType.Expense, "Operating expense", "00"),
        new("6060", "Motor Vehicle - Fuel and Running", AccountType.Expense, "Operating expense", "01"),
        new("6070", "Office Expenses", AccountType.Expense, "Operating expense", "01"),
        new("6080", "Rent and Occupancy", AccountType.Expense, "Operating expense", "01"),
        new("6090", "Repairs and Maintenance", AccountType.Expense, "Operating expense", "01"),
        new("6100", "Salaries and Wages", AccountType.Expense, "Operating expense", "00"),
        new("6110", "Telephone and Data", AccountType.Expense, "Operating expense", "01"),
        new("6120", "Travel", AccountType.Expense, "Operating expense", "01"),
        // Specification section 10.2 range 9000-9999: control and suspense accounts.
        new("9000", "Opening Balance Suspense", AccountType.Equity, "Control", "00"),
        new("9100", "Suspense / Unallocated", AccountType.Asset, "Control", "00", CurrentNonCurrent.Current),
    ];
}

public sealed record StarterVatCode(
    string Code,
    string Description,
    VatTreatment Treatment,
    decimal RatePercent,
    bool CapitalFlag,
    string Vat201MappingCode);

/// <summary>
/// Default VAT codes from specification section 12.1. The 15% standard rate is seeded as
/// effective-dated rate history, never as a constant in calculation logic (specification section 3).
/// </summary>
public static class StarterVatCodes
{
    /// <summary>South African standard VAT rate effective 1 April 2018 (SARS rate change from 14%).</summary>
    public static readonly DateOnly StandardRateEffectiveFrom = new(2018, 4, 1);
    public const string RuleSetVersion = "ZA-VAT-2026.09";

    public static readonly IReadOnlyList<StarterVatCode> Codes =
    [
        new("00", "Exempt", VatTreatment.Exempt, 0m, false, "EXEMPT"),
        new("01", "Standard rated", VatTreatment.Standard, 15m, false, "STD"),
        new("02", "Capital standard rated", VatTreatment.Standard, 15m, true, "STD_CAP"),
        new("03", "Zero rated", VatTreatment.Zero, 0m, false, "ZERO"),
    ];
}
