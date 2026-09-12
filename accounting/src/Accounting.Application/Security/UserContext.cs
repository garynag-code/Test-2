using Accounting.Domain.Enums;

namespace Accounting.Application.Security;

/// <summary>Authenticated caller together with the roles granted for the entity being acted upon.</summary>
public sealed record UserContext(string UserId, string UserName, Guid EntityId, IReadOnlyCollection<string> Roles)
{
    public bool IsInRole(string role) => Roles.Contains(role);
    public bool HasAnyRole(IEnumerable<string> roles) => roles.Any(IsInRole);

    /// <summary>Sensitive actions such as posting into a soft-locked period. Specification section 6.2.</summary>
    public bool HasElevatedPermission => HasAnyRole(Accounting.Domain.Enums.Roles.Elevated);
    public bool CanPost => HasAnyRole(Accounting.Domain.Enums.Roles.CanPost);
}
