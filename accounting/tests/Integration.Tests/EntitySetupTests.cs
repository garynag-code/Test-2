using Accounting.Application.EntitySetup;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Integration.Tests;

/// <summary>Entity, period and seed-data provisioning (specification sections 10.1, 10.2, 12.1).</summary>
[Collection("database")]
public class EntitySetupTests(DatabaseFixture fixture)
{
    [Fact]
    public async Task New_entity_receives_twelve_contiguous_open_periods()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var periods = await scenario.Db.AccountingPeriods.AsNoTracking()
            .Where(p => p.EntityId == scenario.EntityId)
            .OrderBy(p => p.PeriodNumber)
            .ToListAsync();

        Assert.Equal(12, periods.Count);
        Assert.All(periods, p => Assert.Equal(PeriodStatus.Open, p.Status));
        Assert.Equal(new DateOnly(2026, 3, 1), periods[0].StartDate);
        Assert.Equal(new DateOnly(2027, 2, 28), periods[^1].EndDate);

        for (var i = 1; i < periods.Count; i++)
            Assert.Equal(periods[i - 1].EndDate.AddDays(1), periods[i].StartDate);
    }

    [Fact]
    public async Task Starter_chart_is_seeded_with_normal_balances_and_vat_defaults()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var accounts = await scenario.Db.Accounts.AsNoTracking()
            .Where(a => a.EntityId == scenario.EntityId).ToListAsync();

        Assert.Equal(StarterChartOfAccounts.Accounts.Count, accounts.Count);
        Assert.All(accounts, a => Assert.Equal(Accounting.Domain.Entities.Account.NormalBalanceFor(a.AccountType),
            a.NormalBalance));

        var bank = accounts.Single(a => a.Code == "1000");
        Assert.Equal(ControlAccountType.Bank, bank.ControlAccountType);
        Assert.Equal(ControlAccountType.Vat, accounts.Single(a => a.Code == "2100").ControlAccountType);

        var telephone = accounts.Single(a => a.Code == "6110");
        var standardRated = await scenario.Db.VatCodes.AsNoTracking()
            .FirstAsync(v => v.EntityId == scenario.EntityId && v.Code == "01");
        Assert.Equal(standardRated.Id, telephone.DefaultVatCodeId);
    }

    /// <summary>VAT-AC-002: exempt and zero rated both calculate zero but remain distinct classifications.</summary>
    [Fact]
    public async Task Vat_codes_are_seeded_with_effective_dated_rates()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var codes = await scenario.Db.VatCodes.AsNoTracking()
            .Include(v => v.RateHistory)
            .Where(v => v.EntityId == scenario.EntityId)
            .ToDictionaryAsync(v => v.Code);

        Assert.Equal(4, codes.Count);
        Assert.Equal(15m, codes["01"].RateHistory.Single().RatePercent);
        Assert.Equal(15m, codes["02"].RateHistory.Single().RatePercent);
        Assert.True(codes["02"].CapitalFlag);

        Assert.Equal(0m, codes["00"].RateHistory.Single().RatePercent);
        Assert.Equal(0m, codes["03"].RateHistory.Single().RatePercent);
        Assert.Equal(VatTreatment.Exempt, codes["00"].Treatment);
        Assert.Equal(VatTreatment.Zero, codes["03"].Treatment);
        Assert.NotEqual(codes["00"].Vat201MappingCode, codes["03"].Vat201MappingCode);

        Assert.All(codes.Values, c => Assert.Equal(StarterVatCodes.RuleSetVersion,
            c.RateHistory.Single().SourceRuleSetVersion));
    }

    [Fact]
    public async Task February_year_end_is_clamped_to_a_valid_date_in_a_leap_year()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture, fiscalYearEndingIn: 2028);

        var year = await scenario.Db.FiscalYears.AsNoTracking()
            .FirstAsync(f => f.EntityId == scenario.EntityId);

        Assert.Equal(new DateOnly(2028, 2, 29), year.EndDate);
        Assert.Equal(new DateOnly(2027, 3, 1), year.StartDate);
    }

    [Fact]
    public async Task Entity_creation_is_audited()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);

        var audit = await scenario.Db.AuditEvents.AsNoTracking()
            .FirstAsync(a => a.EntityId == scenario.EntityId && a.EventType == "EntityCreated");

        Assert.Equal("admin-user", audit.ActorUserId);
    }

    [Fact]
    public async Task Entity_creation_requires_administrative_permission()
    {
        await using var scenario = await LedgerScenario.CreateAsync(fixture);
        var audit = new Accounting.Infrastructure.Persistence.AuditEventWriter(scenario.Db, new TestClock());
        var setup = new EntitySetupService(scenario.Db, audit, new TestClock());

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => setup.CreateEntityAsync(
            new CreateEntityRequest { LegalName = "Unauthorised", OpeningFiscalYearEndingIn = 2027 },
            scenario.Preparer));
    }
}
