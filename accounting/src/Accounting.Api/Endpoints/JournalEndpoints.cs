using System.Security.Claims;
using Accounting.Application.Abstractions;
using Accounting.Application.GeneralLedger;
using Accounting.Application.Security;
using Microsoft.EntityFrameworkCore;

namespace Accounting.Api.Endpoints;

public static class JournalEndpoints
{
    public static void MapJournalEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1").RequireAuthorization().WithTags("Journals");

        // Capture a draft journal. Drafts are not accounting records until posted.
        group.MapPost("/entities/{entityId:guid}/journals", async (Guid entityId, JournalRequest request,
            ClaimsPrincipal principal, IEntityAccessService access, IDraftJournalService drafts,
            CancellationToken ct) =>
        {
            var user = await access.ResolveAsync(principal, entityId, ct);
            if (user is null) return Results.Forbid();

            var (_, result) = await drafts.CreateAsync(request.ToPostRequest(entityId), user, ct);
            return result.ToHttpResult();
        });

        group.MapPost("/journals/{journalId:guid}/validate", async (Guid journalId, ClaimsPrincipal principal,
            IEntityAccessService access, IPostingService posting, IAccountingDbContext db,
            CancellationToken ct) =>
        {
            var user = await ResolveForJournalAsync(journalId, principal, access, db, ct);
            if (user is null) return Results.Forbid();

            var result = await posting.ValidateDraftAsync(journalId, user, ct);
            return result.ToHttpResult();
        });

        group.MapPost("/journals/{journalId:guid}/post", async (Guid journalId, ClaimsPrincipal principal,
            IEntityAccessService access, IPostingService posting, IAccountingDbContext db,
            CancellationToken ct) =>
        {
            var user = await ResolveForJournalAsync(journalId, principal, access, db, ct);
            if (user is null) return Results.Forbid();

            var result = await posting.PostDraftAsync(journalId, user, ct);
            return result.ToHttpResult();
        });

        group.MapPost("/journals/{journalId:guid}/reverse", async (Guid journalId, ReverseRequest request,
            ClaimsPrincipal principal, IEntityAccessService access, IPostingService posting,
            IAccountingDbContext db, CancellationToken ct) =>
        {
            var user = await ResolveForJournalAsync(journalId, principal, access, db, ct);
            if (user is null) return Results.Forbid();

            var result = await posting.ReverseAsync(journalId, request.ReversalDate, request.Reason, user, ct);
            return result.ToHttpResult();
        });

        group.MapDelete("/journals/{journalId:guid}", async (Guid journalId, ClaimsPrincipal principal,
            IEntityAccessService access, IDraftJournalService drafts, IAccountingDbContext db,
            CancellationToken ct) =>
        {
            var user = await ResolveForJournalAsync(journalId, principal, access, db, ct);
            if (user is null) return Results.Forbid();

            var result = await drafts.DeleteAsync(journalId, user, ct);
            return result.Succeeded ? Results.NoContent() : result.ToHttpResult();
        });

        group.MapGet("/journals/{journalId:guid}", async (Guid journalId, ClaimsPrincipal principal,
            IEntityAccessService access, IAccountingDbContext db, CancellationToken ct) =>
        {
            var user = await ResolveForJournalAsync(journalId, principal, access, db, ct);
            if (user is null) return Results.Forbid();

            var journal = await db.Journals.AsNoTracking()
                .Where(j => j.Id == journalId)
                .Select(j => new
                {
                    j.Id, j.JournalNumber, j.JournalType, j.Status, j.TransactionDate,
                    j.Description, j.Reference, j.SourceModule, j.PostedBy, j.PostedAtUtc,
                    j.ReversalOfJournalId, j.ReversedByJournalId,
                    Lines = j.Lines.OrderBy(l => l.LineNo).Select(l => new
                    {
                        l.LineNo, l.AccountId, AccountCode = l.Account!.Code, AccountName = l.Account.Name,
                        l.DebitAmount, l.CreditAmount, l.Description, l.Reference,
                    }),
                })
                .FirstOrDefaultAsync(ct);

            return journal is null ? Results.NotFound() : Results.Ok(journal);
        });
    }

    private static async Task<UserContext?> ResolveForJournalAsync(Guid journalId, ClaimsPrincipal principal,
        IEntityAccessService access, IAccountingDbContext db, CancellationToken ct)
    {
        var entityId = await db.Journals.AsNoTracking()
            .Where(j => j.Id == journalId).Select(j => (Guid?)j.EntityId).FirstOrDefaultAsync(ct);
        return entityId is null ? null : await access.ResolveAsync(principal, entityId.Value, ct);
    }
}

public sealed record JournalLineRequest(Guid AccountId, decimal DebitAmount, decimal CreditAmount,
    string? Description, string? Reference);

public sealed record JournalRequest(DateOnly TransactionDate, Domain.Enums.JournalType JournalType,
    string? Description, string? Reference, IReadOnlyList<JournalLineRequest> Lines)
{
    public PostRequest ToPostRequest(Guid entityId) => new()
    {
        EntityId = entityId,
        TransactionDate = TransactionDate,
        JournalType = JournalType,
        Description = Description,
        Reference = Reference,
        Lines = [.. Lines.Select(l => new PostLineRequest
        {
            AccountId = l.AccountId,
            DebitAmount = l.DebitAmount,
            CreditAmount = l.CreditAmount,
            Description = l.Description,
            Reference = l.Reference,
        })],
    };
}

public sealed record ReverseRequest(DateOnly ReversalDate, string Reason);
