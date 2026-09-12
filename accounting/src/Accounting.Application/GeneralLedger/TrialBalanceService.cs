using Accounting.Application.Abstractions;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Accounting.Application.GeneralLedger;

public sealed record TrialBalanceRow(
    Guid AccountId,
    string AccountCode,
    string AccountName,
    AccountType AccountType,
    decimal OpeningBalance,
    decimal PeriodDebit,
    decimal PeriodCredit,
    decimal ClosingBalance)
{
    /// <summary>Closing balance presented in the debit column, or zero.</summary>
    public decimal ClosingDebit => ClosingBalance > 0m ? ClosingBalance : 0m;
    public decimal ClosingCredit => ClosingBalance < 0m ? -ClosingBalance : 0m;
}

public sealed record TrialBalance(
    Guid EntityId,
    DateOnly FromDate,
    DateOnly ToDate,
    IReadOnlyList<TrialBalanceRow> Rows)
{
    public decimal TotalDebit => Rows.Sum(r => r.ClosingDebit);
    public decimal TotalCredit => Rows.Sum(r => r.ClosingCredit);
    public bool IsBalanced => TotalDebit == TotalCredit;
}

public sealed record LedgerLine(
    Guid JournalLineId,
    Guid JournalId,
    string JournalNumber,
    JournalType JournalType,
    JournalStatus JournalStatus,
    DateOnly TransactionDate,
    string? Description,
    string? Reference,
    string SourceModule,
    decimal DebitAmount,
    decimal CreditAmount,
    decimal RunningBalance);

public interface ITrialBalanceService
{
    Task<TrialBalance> GetTrialBalanceAsync(Guid entityId, DateOnly fromDate, DateOnly toDate,
        CancellationToken ct = default);

    Task<IReadOnlyList<LedgerLine>> GetAccountActivityAsync(Guid entityId, Guid accountId,
        DateOnly fromDate, DateOnly toDate, CancellationToken ct = default);
}

/// <summary>
/// Reporting is read-only and derives entirely from posted journal lines
/// (specification sections 4, 5.4 and 17). It never maintains separate balances.
/// </summary>
public sealed class TrialBalanceService(IAccountingDbContext db) : ITrialBalanceService
{
    /// <summary>Reversed journals stay posted for reporting; their reversal carries the offsetting entry.</summary>
    private static readonly JournalStatus[] PostedStatuses = [JournalStatus.Posted, JournalStatus.Reversed];

    public async Task<TrialBalance> GetTrialBalanceAsync(Guid entityId, DateOnly fromDate, DateOnly toDate,
        CancellationToken ct = default)
    {
        var posted = from line in db.JournalLines.AsNoTracking()
                     join journal in db.Journals.AsNoTracking() on line.JournalId equals journal.Id
                     where line.EntityId == entityId && PostedStatuses.Contains(journal.Status)
                     select new { journal.TransactionDate, line.AccountId, line.DebitAmount, line.CreditAmount };

        var movements = await posted
            .Where(x => x.TransactionDate <= toDate)
            .GroupBy(x => x.AccountId)
            .Select(g => new
            {
                AccountId = g.Key,
                Opening = g.Where(x => x.TransactionDate < fromDate)
                           .Sum(x => x.DebitAmount - x.CreditAmount),
                PeriodDebit = g.Where(x => x.TransactionDate >= fromDate).Sum(x => x.DebitAmount),
                PeriodCredit = g.Where(x => x.TransactionDate >= fromDate).Sum(x => x.CreditAmount),
            })
            .ToListAsync(ct);

        var accounts = await db.Accounts.AsNoTracking()
            .Where(a => a.EntityId == entityId)
            .OrderBy(a => a.Code)
            .Select(a => new { a.Id, a.Code, a.Name, a.AccountType })
            .ToListAsync(ct);

        var byAccount = movements.ToDictionary(m => m.AccountId);

        var rows = accounts
            .Select(a =>
            {
                byAccount.TryGetValue(a.Id, out var m);
                var opening = m?.Opening ?? 0m;
                var debit = m?.PeriodDebit ?? 0m;
                var credit = m?.PeriodCredit ?? 0m;
                return new TrialBalanceRow(a.Id, a.Code, a.Name, a.AccountType,
                    opening, debit, credit, opening + debit - credit);
            })
            .Where(r => r.OpeningBalance != 0m || r.PeriodDebit != 0m || r.PeriodCredit != 0m)
            .ToList();

        return new TrialBalance(entityId, fromDate, toDate, rows);
    }

    public async Task<IReadOnlyList<LedgerLine>> GetAccountActivityAsync(Guid entityId, Guid accountId,
        DateOnly fromDate, DateOnly toDate, CancellationToken ct = default)
    {
        var opening = await (from line in db.JournalLines.AsNoTracking()
                             join journal in db.Journals.AsNoTracking() on line.JournalId equals journal.Id
                             where line.EntityId == entityId && line.AccountId == accountId
                                && PostedStatuses.Contains(journal.Status)
                                && journal.TransactionDate < fromDate
                             select line.DebitAmount - line.CreditAmount)
            .SumAsync(ct);

        var lines = await (from line in db.JournalLines.AsNoTracking()
                           join journal in db.Journals.AsNoTracking() on line.JournalId equals journal.Id
                           where line.EntityId == entityId && line.AccountId == accountId
                              && PostedStatuses.Contains(journal.Status)
                              && journal.TransactionDate >= fromDate && journal.TransactionDate <= toDate
                           orderby journal.TransactionDate, journal.JournalNumber, line.LineNo
                           select new
                           {
                               LineId = line.Id,
                               journal.Id,
                               journal.JournalNumber,
                               journal.JournalType,
                               journal.Status,
                               journal.TransactionDate,
                               line.Description,
                               line.Reference,
                               journal.SourceModule,
                               line.DebitAmount,
                               line.CreditAmount,
                           })
            .ToListAsync(ct);

        var running = opening;
        return lines.Select(l =>
        {
            running += l.DebitAmount - l.CreditAmount;
            return new LedgerLine(l.LineId, l.Id, l.JournalNumber, l.JournalType, l.Status,
                l.TransactionDate, l.Description, l.Reference, l.SourceModule,
                l.DebitAmount, l.CreditAmount, running);
        }).ToList();
    }
}
