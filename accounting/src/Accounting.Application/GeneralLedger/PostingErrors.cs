namespace Accounting.Application.GeneralLedger;

/// <summary>Stable error codes for the accounting invariants in specification section 9.1.</summary>
public static class PostingErrors
{
    public const string Unbalanced = "GL.UNBALANCED";              // INV-001
    public const string NonPostingAccount = "GL.NON_POSTING_ACCOUNT"; // INV-002
    public const string PeriodNotOpen = "GL.PERIOD_NOT_OPEN";      // INV-003
    public const string NoPeriod = "GL.NO_PERIOD";                 // INV-003
    public const string JournalImmutable = "GL.JOURNAL_IMMUTABLE"; // INV-004
    public const string AlreadyReversed = "GL.ALREADY_REVERSED";   // INV-005
    public const string NotPosted = "GL.NOT_POSTED";
    public const string NotFound = "GL.NOT_FOUND";
    public const string Forbidden = "GL.FORBIDDEN";
    public const string InvalidLine = "GL.INVALID_LINE";
    public const string TooFewLines = "GL.TOO_FEW_LINES";
    public const string AccountNotFound = "GL.ACCOUNT_NOT_FOUND";
    public const string AccountInactive = "GL.ACCOUNT_INACTIVE";
    public const string WrongEntity = "GL.WRONG_ENTITY";
    public const string EntityInactive = "GL.ENTITY_INACTIVE";
    public const string PrecisionExceeded = "GL.PRECISION_EXCEEDED";
    public const string DuplicateSource = "GL.DUPLICATE_SOURCE";   // supports INV-007
    public const string ZeroValue = "GL.ZERO_VALUE";
    public const string VatMismatch = "GL.VAT_MISMATCH";           // section 12.3
    public const string VatOnControlAccount = "GL.VAT_ON_CONTROL_ACCOUNT";
    public const string NoVatReasonRequired = "GL.NO_VAT_REASON_REQUIRED";
}
