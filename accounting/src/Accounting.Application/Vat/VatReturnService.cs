using Accounting.Application.Abstractions;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Accounting.Application.Vat;

public sealed record VatReturnLine(
    string Vat201MappingCode,
    string VatCode,
    VatTreatment Treatment,
    VatDirection Direction,
    decimal TaxableAmount,
    decimal VatAmount,
    decimal RecoverableVatAmount,
    int TransactionCount);

public sealed record VatReturnSummary(
    Guid EntityId,
    DateOnly FromDate,
    DateOnly ToDate,
    IReadOnlyList<VatReturnLine> Lines,
    decimal VatControlAccountBalance)
{
    public decimal OutputVat => Lines.Where(l => l.Direction == VatDirection.Output).Sum(l => l.VatAmount);
    public decimal InputVat => Lines.Where(l => l.Direction == VatDirection.Input).Sum(l => l.RecoverableVatAmount);

    /// <summary>Net VAT payable to SARS; negative where the entity is in a refund position.</summary>
    public decimal NetVatPayable => OutputVat - InputVat;

    /// <summary>
    /// Difference between the VAT the tax lines account for and the movement on the VAT control
    /// account. Anything other than zero means VAT was posted without a tax line, or the reverse,
    /// and must be investigated before the return is filed (specification section 12.3).
    /// </summary>
    public decimal UnreconciledDifference => decimal.Round(NetVatPayable + VatControlAccountBalance, 4);
    public bool Reconciles => UnreconciledDifference == 0m;
}

public interface IVatReturnService
{
    Task<VatReturnSummary> GetReturnSummaryAsync(Guid entityId, DateOnly fromDate, DateOnly toDate,
        CancellationToken ct = default);
}

/// <summary>
/// VAT return-period summary and control-account reconciliation. The VAT201 box mapping comes from
/// the code's configuration, not from code logic (specification section 12.3).
/// </summary>
public sealed class VatReturnService(IAccountingDbContext db) : IVatReturnService
{
    private static readonly JournalStatus[] PostedStatuses = [JournalStatus.Posted, JournalStatus.Reversed];

    public async Task<VatReturnSummary> GetReturnSummaryAsync(Guid entityId, DateOnly fromDate, DateOnly toDate,
        CancellationToken ct = default)
    {
        // Only tax lines attached to posted journal lines count towards a return.
        var posted = from taxLine in db.TaxLines.AsNoTracking()
                     join line in db.JournalLines.AsNoTracking() on taxLine.Id equals line.TaxLineId
                     join journal in db.Journals.AsNoTracking() on line.JournalId equals journal.Id
                     where taxLine.EntityId == entityId
                        && PostedStatuses.Contains(journal.Status)
                        && journal.TransactionDate >= fromDate
                        && journal.TransactionDate <= toDate
                     select new { taxLine, line.DebitAmount };

        var grouped = await posted
            .GroupBy(x => new
            {
                x.taxLine.Vat201MappingCode,
                x.taxLine.VatCodeSnapshot,
                x.taxLine.Treatment,
                x.taxLine.Direction,
            })
            .Select(g => new
            {
                g.Key,
                Taxable = g.Sum(x => x.taxLine.TaxableAmount),
                Vat = g.Sum(x => x.taxLine.VatAmount),
                Recoverable = g.Sum(x => x.taxLine.RecoverableVatAmount),
                Count = g.Count(),
            })
            .ToListAsync(ct);

        var lines = grouped
            .Select(g => new VatReturnLine(
                g.Key.Vat201MappingCode ?? "UNMAPPED",
                g.Key.VatCodeSnapshot,
                g.Key.Treatment,
                g.Key.Direction,
                g.Taxable,
                g.Vat,
                g.Recoverable,
                g.Count))
            .OrderBy(l => l.Vat201MappingCode)
            .ThenBy(l => l.VatCode)
            .ToList();

        var controlBalance = await (from line in db.JournalLines.AsNoTracking()
                                    join journal in db.Journals.AsNoTracking() on line.JournalId equals journal.Id
                                    join account in db.Accounts.AsNoTracking() on line.AccountId equals account.Id
                                    where line.EntityId == entityId
                                       && account.ControlAccountType == ControlAccountType.Vat
                                       && PostedStatuses.Contains(journal.Status)
                                       && journal.TransactionDate >= fromDate
                                       && journal.TransactionDate <= toDate
                                    select line.DebitAmount - line.CreditAmount)
            .SumAsync(ct);

        return new VatReturnSummary(entityId, fromDate, toDate, lines, controlBalance);
    }
}
