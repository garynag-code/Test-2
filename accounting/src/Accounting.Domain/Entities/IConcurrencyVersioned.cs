namespace Accounting.Domain.Entities;

/// <summary>
/// Optimistic concurrency token for editable master and configuration data
/// (specification section 8.1). Incremented by the persistence layer on each update.
/// </summary>
public interface IConcurrencyVersioned
{
    int Version { get; set; }
}
