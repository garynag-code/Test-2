using Accounting.Domain.Enums;

namespace Accounting.Application.GeneralLedger;

public sealed record PostLineRequest
{
    public required Guid AccountId { get; init; }
    public decimal DebitAmount { get; init; }
    public decimal CreditAmount { get; init; }
    public string? Description { get; init; }
    public string? Reference { get; init; }
    public Guid? DocumentLinkId { get; init; }
}

/// <summary>
/// A posting request. Every module, including future subledgers, reaches the ledger
/// through this contract rather than writing journal rows directly (specification section 5.4).
/// </summary>
public sealed record PostRequest
{
    public required Guid EntityId { get; init; }
    public required DateOnly TransactionDate { get; init; }
    public JournalType JournalType { get; init; } = JournalType.GEN;
    public string? Description { get; init; }
    public string? Reference { get; init; }
    public string SourceModule { get; init; } = "GeneralLedger";
    public Guid? SourceRecordId { get; init; }
    public required IReadOnlyList<PostLineRequest> Lines { get; init; }
}

public sealed record PostError(string Code, string Message);

public sealed record PostResult
{
    public bool Succeeded => Errors.Count == 0;
    public Guid? JournalId { get; init; }
    public string? JournalNumber { get; init; }
    public IReadOnlyList<PostError> Errors { get; init; } = [];

    public static PostResult Ok(Guid journalId, string journalNumber) =>
        new() { JournalId = journalId, JournalNumber = journalNumber };

    public static PostResult Fail(params PostError[] errors) => new() { Errors = errors };
    public static PostResult Fail(string code, string message) => Fail(new PostError(code, message));
}

/// <summary>Specification section 11.2.</summary>
public interface IPostingService
{
    Task<PostResult> ValidateAsync(PostRequest request, Security.UserContext user, CancellationToken ct = default);
    Task<PostResult> PostAsync(PostRequest request, Security.UserContext user, CancellationToken ct = default);
    Task<PostResult> ReverseAsync(Guid journalId, DateOnly reversalDate, string reason,
        Security.UserContext user, CancellationToken ct = default);

    /// <summary>Validates a stored draft journal without changing it.</summary>
    Task<PostResult> ValidateDraftAsync(Guid journalId, Security.UserContext user, CancellationToken ct = default);

    /// <summary>Posts a stored draft journal through the same validation path as any other posting.</summary>
    Task<PostResult> PostDraftAsync(Guid journalId, Security.UserContext user, CancellationToken ct = default);
}
