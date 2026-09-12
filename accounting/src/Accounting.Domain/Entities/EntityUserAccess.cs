using System.ComponentModel.DataAnnotations;

namespace Accounting.Domain.Entities;

/// <summary>Entity-scoped permission grant. Specification section 6.2.</summary>
public class EntityUserAccess
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EntityId { get; set; }
    public Entity? Entity { get; set; }

    [MaxLength(450)] public required string UserId { get; set; }
    [MaxLength(50)] public required string Role { get; set; }

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    [MaxLength(450)] public string? CreatedBy { get; set; }
}

/// <summary>Per-entity journal numbering counter, incremented inside the posting transaction.</summary>
public class JournalNumberSequence
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EntityId { get; set; }
    [MaxLength(10)] public required string Prefix { get; set; }
    public int NextNumber { get; set; } = 1;
}
