using System.Text.RegularExpressions;
using Accounting.Application.Abstractions;
using Accounting.Domain.Entities;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Accounting.Application.Banking;

/// <summary>
/// A suggested allocation, naming the rule that produced it so a reviewer can see why
/// (specification AUT-AC-001).
/// </summary>
public sealed record AllocationSuggestion(
    Guid RuleId,
    string RuleName,
    string MatchExpression,
    RuleMatchType MatchType,
    Guid AccountId,
    Guid? VatCodeId,
    string? NoVatReason,
    int Confidence);

/// <summary>Specification section 28.3.</summary>
public interface IAllocationRuleEngine
{
    /// <summary>The best-matching rule for a transaction, or null when none applies.</summary>
    Task<AllocationSuggestion?> SuggestAsync(BankTransaction transaction, CancellationToken ct = default);

    /// <summary>Transactions a rule would match, for testing a rule against history.</summary>
    Task<IReadOnlyList<BankTransaction>> TestAsync(Guid ruleId, CancellationToken ct = default);

    /// <summary>Whether a rule's condition matches a description.</summary>
    static bool Matches(RuleMatchType matchType, string matchText, string description)
    {
        if (string.IsNullOrWhiteSpace(matchText)) return false;

        var text = description.Trim();
        var pattern = matchText.Trim();

        return matchType switch
        {
            RuleMatchType.Exact => text.Equals(pattern, StringComparison.OrdinalIgnoreCase),
            RuleMatchType.Contains => text.Contains(pattern, StringComparison.OrdinalIgnoreCase),
            RuleMatchType.StartsWith => text.StartsWith(pattern, StringComparison.OrdinalIgnoreCase),
            RuleMatchType.Wildcard => WildcardMatches(pattern, text),
            _ => false,
        };
    }

    /// <summary>Matches a shell-style pattern where * stands for any run and ? for one character.</summary>
    private static bool WildcardMatches(string pattern, string text)
    {
        var regex = "^" + Regex.Escape(pattern).Replace("\\*", ".*").Replace("\\?", ".") + "$";
        return Regex.IsMatch(text, regex, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant,
            TimeSpan.FromMilliseconds(250));
    }
}

public sealed class AllocationRuleEngine(IAccountingDbContext db) : IAllocationRuleEngine
{
    public async Task<AllocationSuggestion?> SuggestAsync(BankTransaction transaction,
        CancellationToken ct = default)
    {
        var candidates = await db.AllocationRules.AsNoTracking()
            .Where(r => r.EntityId == transaction.EntityId
                && r.Active
                && r.Confidence >= AllocationRule.MinimumSuggestibleConfidence
                && (r.BankAccountId == null || r.BankAccountId == transaction.BankAccountId))
            .OrderBy(r => r.Sequence)
            .ThenByDescending(r => r.Confidence)
            .ToListAsync(ct);

        var moneyIn = transaction.Amount > 0m;

        foreach (var rule in candidates)
        {
            if (rule.AppliesToMoneyIn is { } direction && direction != moneyIn) continue;

            // A rule may match either the description or the detail field some formats carry beside it.
            var matched = IAllocationRuleEngine.Matches(rule.MatchType, rule.MatchText, transaction.Description)
                || (transaction.Detail is not null
                    && IAllocationRuleEngine.Matches(rule.MatchType, rule.MatchText, transaction.Detail));

            if (!matched) continue;

            return new AllocationSuggestion(rule.Id, rule.Name, rule.MatchText, rule.MatchType,
                rule.AccountId, rule.VatCodeId, rule.NoVatReason, rule.Confidence);
        }

        return null;
    }

    public async Task<IReadOnlyList<BankTransaction>> TestAsync(Guid ruleId, CancellationToken ct = default)
    {
        var rule = await db.AllocationRules.AsNoTracking().FirstOrDefaultAsync(r => r.Id == ruleId, ct);
        if (rule is null) return [];

        var transactions = await db.BankTransactions.AsNoTracking()
            .Where(t => t.EntityId == rule.EntityId
                && (rule.BankAccountId == null || t.BankAccountId == rule.BankAccountId))
            .OrderByDescending(t => t.TransactionDate)
            .Take(1000)
            .ToListAsync(ct);

        return transactions
            .Where(t => IAllocationRuleEngine.Matches(rule.MatchType, rule.MatchText, t.Description)
                || (t.Detail is not null
                    && IAllocationRuleEngine.Matches(rule.MatchType, rule.MatchText, t.Detail)))
            .ToList();
    }
}
