using Accounting.Application.Abstractions;
using Accounting.Application.Security;
using Accounting.Domain.Entities;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Accounting.Application.EntitySetup;

public sealed record PeriodChangeResult(bool Succeeded, string? ErrorCode = null, string? Message = null)
{
    public static PeriodChangeResult Ok() => new(true);
    public static PeriodChangeResult Fail(string code, string message) => new(false, code, message);
}

public interface IPeriodService
{
    Task<PeriodChangeResult> SetStatusAsync(Guid periodId, PeriodStatus status, string reason,
        UserContext user, CancellationToken ct = default);
}

/// <summary>
/// Period locking and the authorised reopen workflow. Specification sections 6.2, 8.3 and GL-AC-003.
/// </summary>
public sealed class PeriodService(IAccountingDbContext db, IAuditEventWriter audit, IClock clock) : IPeriodService
{
    public async Task<PeriodChangeResult> SetStatusAsync(Guid periodId, PeriodStatus status, string reason,
        UserContext user, CancellationToken ct = default)
    {
        var period = await db.AccountingPeriods.FirstOrDefaultAsync(p => p.Id == periodId, ct);
        if (period is null)
            return PeriodChangeResult.Fail("PERIOD.NOT_FOUND", "Accounting period not found.");
        if (period.EntityId != user.EntityId)
            return PeriodChangeResult.Fail("PERIOD.FORBIDDEN", "User has no access to this entity.");

        var isReopen = status < period.Status;

        // Locking down is a preparer-level action; relaxing a lock is an elevated, audited event.
        if (isReopen && !user.HasElevatedPermission)
            return PeriodChangeResult.Fail("PERIOD.FORBIDDEN",
                "Reopening a locked period requires elevated permission.");
        if (!isReopen && !user.CanPost)
            return PeriodChangeResult.Fail("PERIOD.FORBIDDEN", "User is not permitted to change period status.");
        if (isReopen && string.IsNullOrWhiteSpace(reason))
            return PeriodChangeResult.Fail("PERIOD.REASON_REQUIRED", "A reason is required to reopen a period.");

        var previous = period.Status;
        if (previous == status) return PeriodChangeResult.Ok();

        period.Status = status;
        period.UpdatedAtUtc = clock.UtcNow;
        period.UpdatedBy = user.UserId;

        audit.Append(isReopen ? "PeriodReopened" : "PeriodLocked", period.EntityId,
            nameof(AccountingPeriod), period.Id, user,
            new { period.Name, From = previous.ToString(), To = status.ToString(), Reason = reason });

        await db.SaveChangesAsync(ct);
        return PeriodChangeResult.Ok();
    }
}
