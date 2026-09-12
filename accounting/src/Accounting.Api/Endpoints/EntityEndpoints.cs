using System.Security.Claims;
using Accounting.Application.Abstractions;
using Accounting.Application.EntitySetup;
using Accounting.Application.Security;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Accounting.Api.Endpoints;

public static class EntityEndpoints
{
    public static void MapEntityEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1").RequireAuthorization().WithTags("Entities");

        group.MapPost("/entities", async (CreateEntityRequest request, ClaimsPrincipal principal,
            IEntitySetupService setup, IEntityAccessService access, IAccountingDbContext db,
            CancellationToken ct) =>
        {
            var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
            if (userId is null) return Results.Unauthorized();

            // Entity creation is a firm-administration action performed before any entity grant exists.
            var roles = await access.GetGlobalRolesAsync(userId, ct);
            var user = new UserContext(userId, principal.Identity?.Name ?? userId, Guid.Empty, roles);
            if (!user.HasElevatedPermission) return Results.Forbid();

            var entity = await setup.CreateEntityAsync(request, user, ct);
            return Results.Created($"/api/v1/entities/{entity.Id}", new { entity.Id, entity.LegalName });
        });

        group.MapGet("/entities", async (ClaimsPrincipal principal, IEntityAccessService access,
            IAccountingDbContext db, CancellationToken ct) =>
        {
            var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
            if (userId is null) return Results.Unauthorized();

            var ids = await access.GetAccessibleEntityIdsAsync(userId, ct);
            var entities = await db.Entities.AsNoTracking()
                .Where(e => ids.Contains(e.Id))
                .OrderBy(e => e.LegalName)
                .Select(e => new { e.Id, e.LegalName, e.TradingName, e.BaseCurrencyCode, e.Active })
                .ToListAsync(ct);
            return Results.Ok(entities);
        });

        group.MapGet("/entities/{entityId:guid}/accounts", async (Guid entityId, ClaimsPrincipal principal,
            IEntityAccessService access, IAccountingDbContext db, CancellationToken ct) =>
        {
            if (await access.ResolveAsync(principal, entityId, ct) is null) return Results.Forbid();

            var accounts = await db.Accounts.AsNoTracking()
                .Where(a => a.EntityId == entityId)
                .OrderBy(a => a.Code)
                .Select(a => new
                {
                    a.Id, a.Code, a.Name, a.AccountType, a.AccountSubtype,
                    a.NormalBalance, a.PostingAllowed, a.ControlAccountType, a.Active,
                })
                .ToListAsync(ct);
            return Results.Ok(accounts);
        });

        group.MapGet("/entities/{entityId:guid}/periods", async (Guid entityId, ClaimsPrincipal principal,
            IEntityAccessService access, IAccountingDbContext db, CancellationToken ct) =>
        {
            if (await access.ResolveAsync(principal, entityId, ct) is null) return Results.Forbid();

            var periods = await db.AccountingPeriods.AsNoTracking()
                .Where(p => p.EntityId == entityId)
                .OrderBy(p => p.StartDate)
                .Select(p => new { p.Id, p.PeriodNumber, p.Name, p.StartDate, p.EndDate, p.Status })
                .ToListAsync(ct);
            return Results.Ok(periods);
        });

        group.MapPost("/periods/{periodId:guid}/status", async (Guid periodId, PeriodStatusRequest request,
            ClaimsPrincipal principal, IEntityAccessService access, IPeriodService periods,
            IAccountingDbContext db, CancellationToken ct) =>
        {
            var entityId = await db.AccountingPeriods.AsNoTracking()
                .Where(p => p.Id == periodId).Select(p => (Guid?)p.EntityId).FirstOrDefaultAsync(ct);
            if (entityId is null) return Results.NotFound();

            var user = await access.ResolveAsync(principal, entityId.Value, ct);
            if (user is null) return Results.Forbid();

            var result = await periods.SetStatusAsync(periodId, request.Status, request.Reason, user, ct);
            return result.Succeeded
                ? Results.NoContent()
                : Results.Json(new { result.ErrorCode, result.Message }, statusCode: 422);
        });

        group.MapGet("/entities/{entityId:guid}/vat-codes", async (Guid entityId, ClaimsPrincipal principal,
            IEntityAccessService access, IAccountingDbContext db, CancellationToken ct) =>
        {
            if (await access.ResolveAsync(principal, entityId, ct) is null) return Results.Forbid();

            var codes = await db.VatCodes.AsNoTracking()
                .Where(v => v.EntityId == entityId)
                .OrderBy(v => v.Code)
                .Select(v => new
                {
                    v.Id, v.Code, v.Description, v.Treatment, v.CapitalFlag, v.Vat201MappingCode, v.Active,
                    Rates = v.RateHistory.OrderBy(r => r.EffectiveFrom)
                        .Select(r => new { r.RatePercent, r.EffectiveFrom, r.EffectiveTo, r.SourceRuleSetVersion }),
                })
                .ToListAsync(ct);
            return Results.Ok(codes);
        });
    }
}

public sealed record PeriodStatusRequest(PeriodStatus Status, string Reason);
