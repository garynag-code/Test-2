using Accounting.Application.Abstractions;
using Accounting.Application.Security;
using Accounting.Domain.Entities;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Accounting.Application.EntitySetup;

public sealed record CreateEntityRequest
{
    public required string LegalName { get; init; }
    public string? TradingName { get; init; }
    public string? RegistrationNumber { get; init; }
    public string? EntityTypeCode { get; init; }
    public int FinancialYearEndMonth { get; init; } = 2;
    public int FinancialYearEndDay { get; init; } = 28;
    public string BaseCurrencyCode { get; init; } = "ZAR";
    public bool IsVatVendor { get; init; }
    public string? VatNumber { get; init; }
    public string? IncomeTaxNumber { get; init; }
    /// <summary>Fiscal year to open on creation, identified by the calendar year in which it ends.</summary>
    public required int OpeningFiscalYearEndingIn { get; init; }
    public bool SeedStarterChart { get; init; } = true;
}

public interface IEntitySetupService
{
    Task<Entity> CreateEntityAsync(CreateEntityRequest request, UserContext user, CancellationToken ct = default);
    Task<FiscalYear> CreateFiscalYearAsync(Guid entityId, int endingIn, UserContext user, CancellationToken ct = default);
}

/// <summary>
/// Entity, fiscal year, period, VAT code and chart-of-accounts provisioning.
/// Specification sections 10.1 to 10.4 and milestone M0.
/// </summary>
public sealed class EntitySetupService(IAccountingDbContext db, IAuditEventWriter audit, IClock clock)
    : IEntitySetupService
{
    public async Task<Entity> CreateEntityAsync(CreateEntityRequest request, UserContext user,
        CancellationToken ct = default)
    {
        if (!user.HasAnyRole(Roles.Elevated))
            throw new UnauthorizedAccessException("Creating an entity requires firm or system administration.");

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var entity = new Entity
        {
            LegalName = request.LegalName,
            TradingName = request.TradingName,
            RegistrationNumber = request.RegistrationNumber,
            EntityTypeCode = request.EntityTypeCode,
            FinancialYearEndMonth = request.FinancialYearEndMonth,
            FinancialYearEndDay = request.FinancialYearEndDay,
            BaseCurrencyCode = request.BaseCurrencyCode,
            IsVatVendor = request.IsVatVendor,
            VatNumber = request.VatNumber,
            IncomeTaxNumber = request.IncomeTaxNumber,
            CreatedAtUtc = clock.UtcNow,
            CreatedBy = user.UserId,
        };
        db.Entities.Add(entity);

        var vatCodesByCode = SeedVatCodes(entity.Id, user);
        if (request.SeedStarterChart) SeedChartOfAccounts(entity.Id, vatCodesByCode, user);

        BuildFiscalYear(entity, request.OpeningFiscalYearEndingIn, user);

        audit.Append("EntityCreated", entity.Id, nameof(Entity), entity.Id, user,
            new { entity.LegalName, entity.RegistrationNumber, FiscalYear = request.OpeningFiscalYearEndingIn });

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return entity;
    }

    public async Task<FiscalYear> CreateFiscalYearAsync(Guid entityId, int endingIn, UserContext user,
        CancellationToken ct = default)
    {
        if (entityId != user.EntityId || !user.HasAnyRole(Roles.Elevated))
            throw new UnauthorizedAccessException("Creating a fiscal year requires firm or system administration.");

        var entity = await db.Entities.FirstOrDefaultAsync(e => e.Id == entityId, ct)
            ?? throw new InvalidOperationException("Entity not found.");

        var exists = await db.FiscalYears.AnyAsync(f => f.EntityId == entityId && f.Code == endingIn.ToString(), ct);
        if (exists) throw new InvalidOperationException($"Fiscal year {endingIn} already exists for this entity.");

        var year = BuildFiscalYear(entity, endingIn, user);
        audit.Append("FiscalYearCreated", entityId, nameof(FiscalYear), year.Id, user, new { year.Code });
        await db.SaveChangesAsync(ct);
        return year;
    }

    private FiscalYear BuildFiscalYear(Entity entity, int endingIn, UserContext user)
    {
        var end = LastValidDate(endingIn, entity.FinancialYearEndMonth, entity.FinancialYearEndDay);
        var start = end.AddDays(1).AddYears(-1);

        var year = new FiscalYear
        {
            EntityId = entity.Id,
            Code = endingIn.ToString(),
            StartDate = start,
            EndDate = end,
            CreatedAtUtc = clock.UtcNow,
            CreatedBy = user.UserId,
        };
        db.FiscalYears.Add(year);

        // Twelve calendar-month periods covering the year without gaps or overlaps.
        var periodStart = start;
        for (var i = 1; i <= 12; i++)
        {
            var periodEnd = i == 12
                ? end
                : periodStart.AddMonths(1).AddDays(-1);
            if (periodEnd > end) periodEnd = end;

            db.AccountingPeriods.Add(new AccountingPeriod
            {
                EntityId = entity.Id,
                FiscalYearId = year.Id,
                PeriodNumber = i,
                Name = $"{periodStart:MMM yyyy}",
                StartDate = periodStart,
                EndDate = periodEnd,
                Status = PeriodStatus.Open,
                CreatedAtUtc = clock.UtcNow,
                CreatedBy = user.UserId,
            });

            periodStart = periodEnd.AddDays(1);
            if (periodStart > end) break;
        }

        return year;
    }

    private Dictionary<string, VatCode> SeedVatCodes(Guid entityId, UserContext user)
    {
        var result = new Dictionary<string, VatCode>();
        foreach (var seed in StarterVatCodes.Codes)
        {
            var code = new VatCode
            {
                EntityId = entityId,
                Code = seed.Code,
                Description = seed.Description,
                Treatment = seed.Treatment,
                CapitalFlag = seed.CapitalFlag,
                Vat201MappingCode = seed.Vat201MappingCode,
                CreatedAtUtc = clock.UtcNow,
                CreatedBy = user.UserId,
            };
            code.RateHistory.Add(new VatRateHistory
            {
                VatCodeId = code.Id,
                RatePercent = seed.RatePercent,
                EffectiveFrom = StarterVatCodes.StandardRateEffectiveFrom,
                SourceRuleSetVersion = StarterVatCodes.RuleSetVersion,
            });
            db.VatCodes.Add(code);
            result[seed.Code] = code;
        }
        return result;
    }

    private void SeedChartOfAccounts(Guid entityId, IReadOnlyDictionary<string, VatCode> vatCodes, UserContext user)
    {
        foreach (var seed in StarterChartOfAccounts.Accounts)
        {
            db.Accounts.Add(new Account
            {
                EntityId = entityId,
                Code = seed.Code,
                Name = seed.Name,
                AccountType = seed.AccountType,
                AccountSubtype = seed.Subtype,
                NormalBalance = Account.NormalBalanceFor(seed.AccountType),
                PostingAllowed = seed.PostingAllowed,
                CurrentNonCurrent = seed.CurrentNonCurrent,
                ControlAccountType = seed.ControlAccountType,
                DefaultVatCodeId = vatCodes.TryGetValue(seed.DefaultVatCode, out var vat) ? vat.Id : null,
                CreatedAtUtc = clock.UtcNow,
                CreatedBy = user.UserId,
            });
        }
    }

    /// <summary>
    /// Resolves the financial year-end date. A configured day that is the last day of that month in a
    /// common year is treated as a month-end year-end, so a 28 February year-end becomes 29 February in a
    /// leap year. Without this, 29 February would fall outside every accounting period and no journal
    /// could be dated on it (INV-003).
    /// </summary>
    private static DateOnly LastValidDate(int year, int month, int day)
    {
        const int CommonYear = 2001;
        var daysInMonth = DateTime.DaysInMonth(year, month);
        var isMonthEndConvention = day >= DateTime.DaysInMonth(CommonYear, month);
        return new DateOnly(year, month, isMonthEndConvention ? daysInMonth : Math.Min(day, daysInMonth));
    }
}
