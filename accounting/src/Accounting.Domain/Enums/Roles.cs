namespace Accounting.Domain.Enums;

/// <summary>Specification section 6.2 role catalogue.</summary>
public static class Roles
{
    public const string SystemAdmin = "SystemAdmin";
    public const string FirmAdmin = "FirmAdmin";
    public const string Reviewer = "Reviewer";
    public const string Preparer = "Preparer";
    public const string DataCapturer = "DataCapturer";
    public const string ReadOnly = "ReadOnly";

    public static readonly string[] All =
        [SystemAdmin, FirmAdmin, Reviewer, Preparer, DataCapturer, ReadOnly];

    /// <summary>Roles that may create or reverse postings.</summary>
    public static readonly string[] CanPost = [SystemAdmin, FirmAdmin, Reviewer, Preparer];

    /// <summary>Roles permitted the elevated actions in specification section 6.2.</summary>
    public static readonly string[] Elevated = [SystemAdmin, FirmAdmin];
}
