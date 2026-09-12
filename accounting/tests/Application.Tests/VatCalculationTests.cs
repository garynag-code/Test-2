using Accounting.Application.Vat;
using Xunit;

namespace Application.Tests;

/// <summary>
/// The arithmetic of the VAT split, independent of the database.
/// Specification section 12.3 and acceptance test VAT-AC-001.
/// </summary>
public class VatSplitTests
{
    /// <summary>VAT-AC-001: R1,150 VAT-inclusive at 15% is R1,000 net plus R150 VAT.</summary>
    [Fact]
    public void Inclusive_amount_at_fifteen_percent_splits_into_net_and_vat()
    {
        var (taxable, vat) = VatCalculationService.Split(1150m, 15m, amountIncludesVat: true);

        Assert.Equal(1000.00m, taxable);
        Assert.Equal(150.00m, vat);
    }

    [Fact]
    public void Exclusive_amount_at_fifteen_percent_adds_vat()
    {
        var (taxable, vat) = VatCalculationService.Split(1000m, 15m, amountIncludesVat: false);

        Assert.Equal(1000.00m, taxable);
        Assert.Equal(150.00m, vat);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(15)]
    public void Net_and_vat_always_add_back_to_the_inclusive_amount(double rate)
    {
        // Rounding must never lose or create a cent against the amount actually banked.
        for (var cents = 1; cents <= 2000; cents++)
        {
            var gross = cents / 100m;
            var (taxable, vat) = VatCalculationService.Split(gross, (decimal)rate, amountIncludesVat: true);
            Assert.Equal(gross, taxable + vat);
        }
    }

    [Fact]
    public void Vat_is_rounded_to_the_cent_away_from_zero()
    {
        // 0.5 cents rounds up rather than to even, matching how a vendor invoice states VAT.
        var (_, vat) = VatCalculationService.Split(100.05m, 15m, amountIncludesVat: false);

        Assert.Equal(15.01m, vat);
    }

    [Fact]
    public void Zero_rate_leaves_the_whole_amount_taxable_with_no_vat()
    {
        var (taxable, vat) = VatCalculationService.Split(1150m, 0m, amountIncludesVat: true);

        Assert.Equal(1150m, taxable);
        Assert.Equal(0m, vat);
    }

    /// <summary>A bank charge of R655 inclusive, as it appears on an FNB statement.</summary>
    [Fact]
    public void Inclusive_bank_charge_splits_to_the_cent()
    {
        var (taxable, vat) = VatCalculationService.Split(655.00m, 15m, amountIncludesVat: true);

        Assert.Equal(85.43m, vat);
        Assert.Equal(569.57m, taxable);
        Assert.Equal(655.00m, taxable + vat);
    }
}
