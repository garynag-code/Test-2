using Accounting.Domain.Enums;

namespace Accounting.Application.GeneralLedger;

public sealed record PostLineRequest
{
    public required Guid AccountId { get; init; }

    /// <summary>
    /// Line amounts are always exclusive of VAT. Where a line carries a VAT code, the VAT itself is
    /// posted on its own line to the VAT control account, as in the specification's section 12.4 example.
    /// </summary>
    public decimal DebitAmount { get; init; }
    public decimal CreditAmount { get; init; }

    public string? Description { get; init; }
    public string? Reference { get; init; }
    public Guid? DocumentLinkId { get; init; }

    /// <summary>VAT code applied to this line, where one applies.</summary>
    public Guid? VatCodeId { get; init; }

    /// <summary>
    /// VAT the caller calculated on this line. The posting service recalculates it from the code and
    /// transaction date and rejects the journal if the two disagree, so a caller cannot post a VAT
    /// amount the rate does not support. Leave null to accept the calculated amount.
    /// </summary>
    public decimal? VatAmount { get; init; }

    /// <summary>Input VAT on purchases, output VAT on supplies. Defaults from the account type.</summary>
    public VatDirection? VatDirection { get; init; }

    /// <summary>
    /// Reason recorded when a transaction is deliberately allocated without VAT although the account
    /// defaults to a taxable code (specification section 12.3). Enforced by the allocation step.
    /// </summary>
    public string? NoVatReason { get; init; }
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

    /// <summary>
    /// Date that determines the VAT rate, where it differs from the transaction date. A reversal pins
    /// this to the original journal's date so a rate change between the two cannot stop the reversal
    /// undoing the original exactly.
    /// </summary>
    public DateOnly? TaxPointDate { get; init; }
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
