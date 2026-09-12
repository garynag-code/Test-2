using Accounting.Application.Security;

namespace Accounting.Application.Security;

/// <summary>
/// Resolves the roles a user holds for an entity. Entity-level authorisation is enforced
/// server-side for every request (specification sections 5.4 and 6.2, SEC-AC-001).
/// </summary>
public interface IEntityAccessService
{
    Task<UserContext?> GetContextAsync(string userId, Guid entityId, CancellationToken ct = default);
    Task<IReadOnlyList<Guid>> GetAccessibleEntityIdsAsync(string userId, CancellationToken ct = default);

    /// <summary>Firm-wide roles, used for actions that precede any entity grant such as entity creation.</summary>
    Task<IReadOnlyCollection<string>> GetGlobalRolesAsync(string userId, CancellationToken ct = default);
}
