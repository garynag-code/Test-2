using System.ComponentModel.DataAnnotations;

namespace Accounting.Domain.Entities;

/// <summary>Append-only audit trail. Specification sections 6.4 and 9.</summary>
public class AuditEvent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? EntityId { get; set; }

    [MaxLength(50)] public required string EventType { get; set; }
    [MaxLength(50)] public string? RecordType { get; set; }
    public Guid? RecordId { get; set; }

    [MaxLength(450)] public string? ActorUserId { get; set; }
    [MaxLength(256)] public string? ActorUserName { get; set; }
    public DateTime OccurredAtUtc { get; set; } = DateTime.UtcNow;

    /// <summary>Event detail as JSON. Must not contain credentials or unnecessary personal data (section 6.1).</summary>
    public string? DetailJson { get; set; }

    /// <summary>Hash of the posted record snapshot, supporting INV-010 reproducibility.</summary>
    [MaxLength(64)] public string? RecordHash { get; set; }
}
