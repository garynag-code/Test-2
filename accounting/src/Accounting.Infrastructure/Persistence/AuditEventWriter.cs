using System.Text.Json;
using Accounting.Application.Abstractions;
using Accounting.Application.Security;
using Accounting.Domain.Entities;

namespace Accounting.Infrastructure.Persistence;

/// <summary>
/// Appends audit events to the current unit of work so they commit with the change they describe
/// (specification sections 6.4 and 9). The audit table is append-only; see the migration triggers.
/// </summary>
public sealed class AuditEventWriter(AccountingDbContext db, IClock clock) : IAuditEventWriter
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    public void Append(string eventType, Guid? entityId, string? recordType, Guid? recordId,
        UserContext? user, object? detail = null, string? recordHash = null)
    {
        db.AuditEvents.Add(new AuditEvent
        {
            EventType = eventType,
            EntityId = entityId,
            RecordType = recordType,
            RecordId = recordId,
            ActorUserId = user?.UserId,
            ActorUserName = user?.UserName,
            OccurredAtUtc = clock.UtcNow,
            DetailJson = detail is null ? null : JsonSerializer.Serialize(detail, JsonOptions),
            RecordHash = recordHash,
        });
    }
}
