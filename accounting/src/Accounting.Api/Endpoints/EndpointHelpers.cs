using System.Security.Claims;
using Accounting.Application.GeneralLedger;
using Accounting.Application.Security;

namespace Accounting.Api.Endpoints;

internal static class EndpointHelpers
{
    /// <summary>
    /// Resolves the caller's roles for the requested entity. A caller without a grant receives 403
    /// even when they know the record identifier (SEC-AC-001).
    /// </summary>
    public static async Task<UserContext?> ResolveAsync(this IEntityAccessService access,
        ClaimsPrincipal principal, Guid entityId, CancellationToken ct)
    {
        var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        return userId is null ? null : await access.GetContextAsync(userId, entityId, ct);
    }

    public static IResult ToHttpResult(this PostResult result) =>
        result.Succeeded
            ? Results.Ok(new { result.JournalId, result.JournalNumber })
            : Results.Json(new
            {
                Errors = result.Errors.Select(e => new { e.Code, e.Message }),
            }, statusCode: result.Errors.Any(e => e.Code == PostingErrors.Forbidden) ? 403 : 422);
}
