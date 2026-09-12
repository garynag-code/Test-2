using System.Security.Claims;
using Accounting.Application.Abstractions;
using Accounting.Application.GeneralLedger;
using Accounting.Application.Security;
using Accounting.Application.Vat;
using Microsoft.EntityFrameworkCore;

namespace Accounting.Api.Endpoints;

public static class ReportingEndpoints
{
    public static void MapReportingEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1").RequireAuthorization().WithTags("Reporting");

        group.MapGet("/entities/{entityId:guid}/trial-balance", async (Guid entityId,
            DateOnly fromDate, DateOnly toDate, ClaimsPrincipal principal,
            IEntityAccessService access, ITrialBalanceService reporting, CancellationToken ct) =>
        {
            if (await access.ResolveAsync(principal, entityId, ct) is null) return Results.Forbid();

            var trialBalance = await reporting.GetTrialBalanceAsync(entityId, fromDate, toDate, ct);
            return Results.Ok(new
            {
                trialBalance.EntityId,
                trialBalance.FromDate,
                trialBalance.ToDate,
                trialBalance.TotalDebit,
                trialBalance.TotalCredit,
                trialBalance.IsBalanced,
                Rows = trialBalance.Rows,
            });
        });

        group.MapGet("/accounts/{accountId:guid}/ledger", async (Guid accountId,
            DateOnly fromDate, DateOnly toDate, ClaimsPrincipal principal,
            IEntityAccessService access, ITrialBalanceService reporting, IAccountingDbContext db,
            CancellationToken ct) =>
        {
            var entityId = await db.Accounts.AsNoTracking()
                .Where(a => a.Id == accountId).Select(a => (Guid?)a.EntityId).FirstOrDefaultAsync(ct);
            if (entityId is null) return Results.NotFound();
            if (await access.ResolveAsync(principal, entityId.Value, ct) is null) return Results.Forbid();

            var lines = await reporting.GetAccountActivityAsync(entityId.Value, accountId, fromDate, toDate, ct);
            return Results.Ok(lines);
        });

        group.MapGet("/entities/{entityId:guid}/vat-return", async (Guid entityId,
            DateOnly fromDate, DateOnly toDate, ClaimsPrincipal principal,
            IEntityAccessService access, IVatReturnService returns, CancellationToken ct) =>
        {
            if (await access.ResolveAsync(principal, entityId, ct) is null) return Results.Forbid();

            var summary = await returns.GetReturnSummaryAsync(entityId, fromDate, toDate, ct);
            return Results.Ok(new
            {
                summary.EntityId,
                summary.FromDate,
                summary.ToDate,
                summary.OutputVat,
                summary.InputVat,
                summary.NetVatPayable,
                summary.VatControlAccountBalance,
                summary.UnreconciledDifference,
                summary.Reconciles,
                summary.Lines,
            });
        });

        group.MapGet("/entities/{entityId:guid}/audit-events", async (Guid entityId, ClaimsPrincipal principal,
            IEntityAccessService access, IAccountingDbContext db, int take, CancellationToken ct) =>
        {
            if (await access.ResolveAsync(principal, entityId, ct) is null) return Results.Forbid();

            var events = await db.AuditEvents.AsNoTracking()
                .Where(a => a.EntityId == entityId)
                .OrderByDescending(a => a.OccurredAtUtc)
                .Take(take <= 0 ? 100 : Math.Min(take, 500))
                .Select(a => new
                {
                    a.Id, a.EventType, a.RecordType, a.RecordId,
                    a.ActorUserName, a.OccurredAtUtc, a.DetailJson,
                })
                .ToListAsync(ct);
            return Results.Ok(events);
        });
    }
}
