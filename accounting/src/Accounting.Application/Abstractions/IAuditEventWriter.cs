using Accounting.Application.Security;

namespace Accounting.Application.Abstractions;

/// <summary>Append-only audit writer. Specification sections 6.4 and 28.3.</summary>
public interface IAuditEventWriter
{
    /// <summary>Appends an audit event to the current unit of work; the caller saves it in its transaction.</summary>
    void Append(string eventType, Guid? entityId, string? recordType, Guid? recordId,
        UserContext? user, object? detail = null, string? recordHash = null);
}
