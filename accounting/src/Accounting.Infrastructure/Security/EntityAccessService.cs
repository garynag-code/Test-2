using Accounting.Application.Security;
using Accounting.Domain.Enums;
using Accounting.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Accounting.Infrastructure.Security;

/// <summary>
/// Resolves entity-scoped roles. Firm and system administrators reach every entity;
/// every other user needs an explicit grant (specification section 6.2, SEC-AC-001).
/// </summary>
public sealed class EntityAccessService(AccountingDbContext db, UserManager<IdentityUser> users)
    : IEntityAccessService
{
    public async Task<UserContext?> GetContextAsync(string userId, Guid entityId, CancellationToken ct = default)
    {
        var user = await users.FindByIdAsync(userId);
        if (user is null) return null;

        var globalRoles = await users.GetRolesAsync(user);
        var isAdministrator = globalRoles.Any(Roles.Elevated.Contains);

        var entityExists = await db.Entities.AsNoTracking().AnyAsync(e => e.Id == entityId, ct);
        if (!entityExists) return null;

        var entityRoles = await db.EntityUserAccess.AsNoTracking()
            .Where(a => a.EntityId == entityId && a.UserId == userId)
            .Select(a => a.Role)
            .ToListAsync(ct);

        if (!isAdministrator && entityRoles.Count == 0) return null;

        var roles = globalRoles.Concat(entityRoles).Distinct().ToList();
        return new UserContext(userId, user.UserName ?? userId, entityId, roles);
    }

    public async Task<IReadOnlyCollection<string>> GetGlobalRolesAsync(string userId, CancellationToken ct = default)
    {
        var user = await users.FindByIdAsync(userId);
        return user is null ? [] : (IReadOnlyCollection<string>)await users.GetRolesAsync(user);
    }

    public async Task<IReadOnlyList<Guid>> GetAccessibleEntityIdsAsync(string userId, CancellationToken ct = default)
    {
        var user = await users.FindByIdAsync(userId);
        if (user is null) return [];

        var globalRoles = await users.GetRolesAsync(user);
        if (globalRoles.Any(Roles.Elevated.Contains))
            return await db.Entities.AsNoTracking().Select(e => e.Id).ToListAsync(ct);

        return await db.EntityUserAccess.AsNoTracking()
            .Where(a => a.UserId == userId)
            .Select(a => a.EntityId)
            .Distinct()
            .ToListAsync(ct);
    }
}
