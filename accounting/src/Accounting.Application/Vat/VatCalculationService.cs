using Accounting.Application.Abstractions;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Accounting.Application.Vat;

/// <summary>
/// The VAT treatment of one amount, resolved against the rate in force on the transaction date.
/// Every field is persisted on the tax line so the calculation stays reproducible (section 12.3).
/// </summary>
public sealed record VatCalculation
{
    public required Guid VatCodeId { get; init; }
    public required string Code { get; init; }
    public required VatTreatment Treatment { get; init; }
    public string? Vat201MappingCode { get; init; }
    public bool CapitalFlag { get; init; }

    public required decimal RatePercent { get; init; }
    /// <summary>Amount excluding VAT — the taxable base.</summary>
    public required decimal TaxableAmount { get; init; }
    public required decimal VatAmount { get; init; }
    /// <summary>Amount including VAT.</summary>
    public decimal GrossAmount => TaxableAmount + VatAmount;

    public required decimal RecoverablePercentage { get; init; }
    public required decimal RecoverableVatAmount { get; init; }
    /// <summary>Input VAT that cannot be recovered and therefore belongs in the expense.</summary>
    public decimal IrrecoverableVatAmount => VatAmount - RecoverableVatAmount;
}

public sealed record VatCalculationResult(VatCalculation? Calculation, string? ErrorCode, string? Message)
{
    public bool Succeeded => Calculation is not null;
    public static VatCalculationResult Ok(VatCalculation calculation) => new(calculation, null, null);
    public static VatCalculationResult Fail(string code, string message) => new(null, code, message);
}

public static class VatErrors
{
    public const string CodeNotFound = "VAT.CODE_NOT_FOUND";
    public const string CodeInactive = "VAT.CODE_INACTIVE";
    public const string NoEffectiveRate = "VAT.NO_EFFECTIVE_RATE";
    public const string WrongEntity = "VAT.WRONG_ENTITY";
    public const string NegativeAmount = "VAT.NEGATIVE_AMOUNT";
    public const string Mismatch = "VAT.MISMATCH";
}

/// <summary>Specification section 28.3.</summary>
public interface IVatCalculationService
{
    /// <summary>
    /// Splits an amount into taxable base and VAT using the rate effective on <paramref name="transactionDate"/>.
    /// </summary>
    Task<VatCalculationResult> CalculateAsync(Guid entityId, Guid vatCodeId, decimal amount,
        bool amountIncludesVat, DateOnly transactionDate, CancellationToken ct = default);

    /// <summary>Rate in force for a code on a date, or null when none is effective.</summary>
    Task<decimal?> ResolveRateAsync(Guid vatCodeId, DateOnly transactionDate, CancellationToken ct = default);
}

public sealed class VatCalculationService(IAccountingDbContext db) : IVatCalculationService
{
    /// <summary>South African VAT is accounted for in cents; the ledger stores four decimals.</summary>
    private const int VatScale = 2;

    public async Task<VatCalculationResult> CalculateAsync(Guid entityId, Guid vatCodeId, decimal amount,
        bool amountIncludesVat, DateOnly transactionDate, CancellationToken ct = default)
    {
        if (amount < 0m)
            return VatCalculationResult.Fail(VatErrors.NegativeAmount,
                "VAT is calculated on a positive amount; use the opposite debit/credit side instead.");

        var code = await db.VatCodes.AsNoTracking()
            .FirstOrDefaultAsync(v => v.Id == vatCodeId, ct);

        if (code is null)
            return VatCalculationResult.Fail(VatErrors.CodeNotFound, "VAT code not found.");
        if (code.EntityId != entityId)
            return VatCalculationResult.Fail(VatErrors.WrongEntity, "VAT code belongs to another entity.");
        if (!code.Active)
            return VatCalculationResult.Fail(VatErrors.CodeInactive, $"VAT code {code.Code} is inactive.");

        var rate = await ResolveRateAsync(vatCodeId, transactionDate, ct);
        if (rate is null)
            return VatCalculationResult.Fail(VatErrors.NoEffectiveRate,
                $"VAT code {code.Code} has no rate effective on {transactionDate:yyyy-MM-dd}.");

        var (taxable, vat) = Split(amount, rate.Value, amountIncludesVat);

        var recoverable = decimal.Round(vat * code.RecoverablePercentage / 100m, VatScale,
            MidpointRounding.AwayFromZero);

        return VatCalculationResult.Ok(new VatCalculation
        {
            VatCodeId = code.Id,
            Code = code.Code,
            Treatment = code.Treatment,
            Vat201MappingCode = code.Vat201MappingCode,
            CapitalFlag = code.CapitalFlag,
            RatePercent = rate.Value,
            TaxableAmount = taxable,
            VatAmount = vat,
            RecoverablePercentage = code.RecoverablePercentage,
            RecoverableVatAmount = recoverable,
        });
    }

    public async Task<decimal?> ResolveRateAsync(Guid vatCodeId, DateOnly transactionDate,
        CancellationToken ct = default)
    {
        // The transaction date determines the rate, so a rate change never restates prior periods
        // (specification sections 3 and 12.3).
        var rates = await db.VatRateHistories.AsNoTracking()
            .Where(r => r.VatCodeId == vatCodeId && r.EffectiveFrom <= transactionDate)
            .OrderByDescending(r => r.EffectiveFrom)
            .Select(r => new { r.RatePercent, r.EffectiveTo })
            .ToListAsync(ct);

        foreach (var rate in rates)
            if (rate.EffectiveTo is null || rate.EffectiveTo >= transactionDate)
                return rate.RatePercent;

        return null;
    }

    /// <summary>
    /// Splits an amount at a rate. VAT is rounded to the cent and the taxable base is the remainder,
    /// so the two always add back to the original amount exactly.
    /// </summary>
    public static (decimal Taxable, decimal Vat) Split(decimal amount, decimal ratePercent, bool amountIncludesVat)
    {
        if (ratePercent == 0m) return (amount, 0m);

        if (amountIncludesVat)
        {
            var vat = decimal.Round(amount * ratePercent / (100m + ratePercent), VatScale,
                MidpointRounding.AwayFromZero);
            return (amount - vat, vat);
        }

        var vatOnNet = decimal.Round(amount * ratePercent / 100m, VatScale, MidpointRounding.AwayFromZero);
        return (amount, vatOnNet);
    }
}
