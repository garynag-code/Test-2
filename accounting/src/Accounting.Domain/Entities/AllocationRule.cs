using System.ComponentModel.DataAnnotations;
using Accounting.Domain.Enums;

namespace Accounting.Domain.Entities;

/// <summary>
/// A remembered allocation. Specification section 15: rules match on exact, contains, starts-with or
/// wildcard conditions and carry the account and VAT default to apply.
/// </summary>
public class AllocationRule : IConcurrencyVersioned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EntityId { get; set; }

    [MaxLength(100)] public required string Name { get; set; }

    /// <summary>Lower runs first, so a specific rule can take precedence over a general one.</summary>
    public int Sequence { get; set; } = 100;

    public RuleMatchType MatchType { get; set; } = RuleMatchType.Contains;
    [MaxLength(200)] public required string MatchText { get; set; }

    /// <summary>Restricts the rule to one bank account; null applies it to all of the entity's accounts.</summary>
    public Guid? BankAccountId { get; set; }

    /// <summary>Applies only to money out, money in, or either.</summary>
    public bool? AppliesToMoneyIn { get; set; }

    public Guid AccountId { get; set; }
    public Account? Account { get; set; }

    public Guid? VatCodeId { get; set; }
    public VatCode? VatCode { get; set; }

    /// <summary>Reason carried when the rule deliberately allocates without VAT (section 12.3).</summary>
    [MaxLength(500)] public string? NoVatReason { get; set; }

    public bool Active { get; set; } = true;

    /// <summary>
    /// How far the rule is trusted, 0 to 100. Falls each time a user overrides the suggestion, so a
    /// repeatedly wrong rule stops being offered (AUT-AC-002).
    /// </summary>
    public int Confidence { get; set; } = 100;

    public int TimesApplied { get; set; }
    public int TimesOverridden { get; set; }
    public DateTime? LastAppliedAtUtc { get; set; }

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    [MaxLength(450)] public string? CreatedBy { get; set; }
    public DateTime? UpdatedAtUtc { get; set; }
    [MaxLength(450)] public string? UpdatedBy { get; set; }
    public int Version { get; set; }

    /// <summary>Below this a rule is remembered but no longer suggested.</summary>
    public const int MinimumSuggestibleConfidence = 40;

    public bool IsSuggestible => Active && Confidence >= MinimumSuggestibleConfidence;
}
