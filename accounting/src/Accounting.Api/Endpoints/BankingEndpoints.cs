using System.Security.Claims;
using Accounting.Application.Abstractions;
using Accounting.Application.Banking;
using Accounting.Application.Security;
using Accounting.Domain.Entities;
using Accounting.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Accounting.Api.Endpoints;

public sealed record AllocateSplitRequest(
    Guid AccountId, decimal GrossAmount, Guid? VatCodeId, string? NoVatReason, string? Description);

public sealed record AllocateRequest(
    IReadOnlyList<AllocateSplitRequest> Splits, Guid? AppliedRuleId, Guid? OverriddenRuleId);

public sealed record CreateAllocationRuleRequest(
    string Name, RuleMatchType MatchType, string MatchText, Guid AccountId,
    Guid? VatCodeId, string? NoVatReason, int? Sequence, Guid? BankAccountId, bool? AppliesToMoneyIn);

public sealed record CreateBankAccountRequest(
    string Name, string BankKey, string? AccountNumber, string? BranchCode, Guid LedgerAccountId);

public static class BankingEndpoints
{
    public static void MapBankingEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1").RequireAuthorization().WithTags("Banking");

        group.MapGet("/entities/{entityId:guid}/bank-accounts", async (Guid entityId,
            ClaimsPrincipal principal, IEntityAccessService access, IAccountingDbContext db,
            CancellationToken ct) =>
        {
            if (await access.ResolveAsync(principal, entityId, ct) is null) return Results.Forbid();

            var accounts = await db.BankAccounts.AsNoTracking()
                .Where(a => a.EntityId == entityId)
                .OrderBy(a => a.Name)
                .Select(a => new
                {
                    a.Id, a.Name, a.BankKey, a.AccountNumber, a.CurrencyCode, a.Active,
                    LedgerAccountCode = a.LedgerAccount!.Code,
                })
                .ToListAsync(ct);
            return Results.Ok(accounts);
        });

        group.MapPost("/entities/{entityId:guid}/bank-accounts", async (Guid entityId,
            CreateBankAccountRequest request, ClaimsPrincipal principal, IEntityAccessService access,
            IAccountingDbContext db, IAuditEventWriter audit, IClock clock, CancellationToken ct) =>
        {
            var user = await access.ResolveAsync(principal, entityId, ct);
            if (user is null) return Results.Forbid();
            if (!user.HasElevatedPermission) return Results.Forbid();

            var ledgerAccount = await db.Accounts.AsNoTracking()
                .FirstOrDefaultAsync(a => a.Id == request.LedgerAccountId && a.EntityId == entityId, ct);
            if (ledgerAccount is null)
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["ledgerAccountId"] = ["Ledger account not found for this entity."],
                });
            if (ledgerAccount.ControlAccountType != ControlAccountType.Bank)
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["ledgerAccountId"] = ["The ledger account must be a bank control account."],
                });

            var bankAccount = new BankAccount
            {
                EntityId = entityId,
                Name = request.Name,
                BankKey = request.BankKey,
                AccountNumber = request.AccountNumber,
                BranchCode = request.BranchCode,
                LedgerAccountId = request.LedgerAccountId,
                CreatedAtUtc = clock.UtcNow,
                CreatedBy = user.UserId,
            };
            db.BankAccounts.Add(bankAccount);
            audit.Append("BankAccountCreated", entityId, nameof(BankAccount), bankAccount.Id, user,
                new { bankAccount.Name, bankAccount.BankKey, LedgerAccount = ledgerAccount.Code });
            await db.SaveChangesAsync(ct);

            return Results.Created($"/api/v1/bank-accounts/{bankAccount.Id}",
                new { bankAccount.Id, bankAccount.Name });
        }).DisableAntiforgery();

        // Parse a statement and report what would be imported, without writing anything.
        group.MapPost("/bank-accounts/{bankAccountId:guid}/imports/preview", async (Guid bankAccountId,
            IFormFile file, ClaimsPrincipal principal, IEntityAccessService access,
            IBankImportService imports, IAccountingDbContext db, CancellationToken ct) =>
        {
            var user = await ResolveForBankAccountAsync(bankAccountId, principal, access, db, ct);
            if (user is null) return Results.Forbid();

            await using var content = file.OpenReadStream();
            var preview = await imports.PreviewAsync(bankAccountId, file.FileName, content, user, ct);

            return Results.Ok(new
            {
                preview.BankAccountId,
                preview.ParserKey,
                preview.FileHash,
                preview.FileAlreadyImported,
                preview.PreviouslyImportedAtUtc,
                preview.NewCount,
                preview.DuplicateCount,
                preview.CanCommit,
                preview.Errors,
                preview.Warnings,
                Lines = preview.Lines.Select(l => new
                {
                    l.Line.RowNumber,
                    l.Line.TransactionDate,
                    l.Line.Amount,
                    l.Line.Balance,
                    l.Line.Description,
                    l.IsDuplicate,
                    l.DuplicateReason,
                }),
            });
        }).DisableAntiforgery();

        group.MapPost("/bank-accounts/{bankAccountId:guid}/imports", async (Guid bankAccountId,
            IFormFile file, bool? confirmReimport, ClaimsPrincipal principal,
            IEntityAccessService access, IBankImportService imports, IAccountingDbContext db,
            CancellationToken ct) =>
        {
            var user = await ResolveForBankAccountAsync(bankAccountId, principal, access, db, ct);
            if (user is null) return Results.Forbid();

            await using var content = file.OpenReadStream();
            var result = await imports.CommitAsync(bankAccountId, file.FileName, content, user,
                confirmReimport ?? false, ct);

            return result.Succeeded
                ? Results.Ok(new { result.BatchId, result.ImportedCount, result.DuplicateCount })
                : Results.Json(new { result.Errors }, statusCode: 422);
        }).DisableAntiforgery();

        // The rule a suggestion came from is returned with it, so a reviewer sees why (AUT-AC-001).
        group.MapGet("/bank-transactions/{transactionId:guid}/suggestion", async (Guid transactionId,
            ClaimsPrincipal principal, IEntityAccessService access, IAllocationRuleEngine rules,
            IAccountingDbContext db, CancellationToken ct) =>
        {
            var transaction = await db.BankTransactions.AsNoTracking()
                .FirstOrDefaultAsync(t => t.Id == transactionId, ct);
            if (transaction is null) return Results.NotFound();
            if (await access.ResolveAsync(principal, transaction.EntityId, ct) is null)
                return Results.Forbid();

            var suggestion = await rules.SuggestAsync(transaction, ct);
            return suggestion is null ? Results.NoContent() : Results.Ok(suggestion);
        });

        group.MapPost("/bank-transactions/{transactionId:guid}/allocate", async (Guid transactionId,
            AllocateRequest request, ClaimsPrincipal principal, IEntityAccessService access,
            IBankAllocationService allocation, IAccountingDbContext db, CancellationToken ct) =>
        {
            var entityId = await db.BankTransactions.AsNoTracking()
                .Where(t => t.Id == transactionId).Select(t => (Guid?)t.EntityId).FirstOrDefaultAsync(ct);
            if (entityId is null) return Results.NotFound();

            var user = await access.ResolveAsync(principal, entityId.Value, ct);
            if (user is null) return Results.Forbid();

            var result = await allocation.AllocateAsync(new AllocationRequest
            {
                BankTransactionId = transactionId,
                AppliedRuleId = request.AppliedRuleId,
                OverriddenRuleId = request.OverriddenRuleId,
                Splits = [.. request.Splits.Select(s => new AllocationSplit
                {
                    AccountId = s.AccountId,
                    GrossAmount = s.GrossAmount,
                    VatCodeId = s.VatCodeId,
                    NoVatReason = s.NoVatReason,
                    Description = s.Description,
                })],
            }, user, ct);

            return result.Succeeded
                ? Results.Ok(new { result.JournalId, result.JournalNumber })
                : Results.Json(new { Errors = result.Errors.Select(e => new { e.Code, e.Message }) },
                    statusCode: 422);
        });

        group.MapGet("/entities/{entityId:guid}/allocation-rules", async (Guid entityId,
            ClaimsPrincipal principal, IEntityAccessService access, IAccountingDbContext db,
            CancellationToken ct) =>
        {
            if (await access.ResolveAsync(principal, entityId, ct) is null) return Results.Forbid();

            var rules = await db.AllocationRules.AsNoTracking()
                .Where(r => r.EntityId == entityId)
                .OrderBy(r => r.Sequence).ThenBy(r => r.Name)
                .Select(r => new
                {
                    r.Id, r.Name, r.Sequence, r.MatchType, r.MatchText, r.AccountId, r.VatCodeId,
                    r.Active, r.Confidence, r.TimesApplied, r.TimesOverridden, r.LastAppliedAtUtc,
                    AccountCode = r.Account!.Code,
                })
                .ToListAsync(ct);
            return Results.Ok(rules);
        });

        group.MapPost("/entities/{entityId:guid}/allocation-rules", async (Guid entityId,
            CreateAllocationRuleRequest request, ClaimsPrincipal principal, IEntityAccessService access,
            IAccountingDbContext db, IAuditEventWriter audit, IClock clock, CancellationToken ct) =>
        {
            var user = await access.ResolveAsync(principal, entityId, ct);
            if (user is null || !user.CanPost) return Results.Forbid();

            var rule = new AllocationRule
            {
                EntityId = entityId,
                Name = request.Name,
                Sequence = request.Sequence ?? 100,
                MatchType = request.MatchType,
                MatchText = request.MatchText,
                AccountId = request.AccountId,
                VatCodeId = request.VatCodeId,
                NoVatReason = request.NoVatReason,
                BankAccountId = request.BankAccountId,
                AppliesToMoneyIn = request.AppliesToMoneyIn,
                CreatedAtUtc = clock.UtcNow,
                CreatedBy = user.UserId,
            };
            db.AllocationRules.Add(rule);
            audit.Append("AllocationRuleCreated", entityId, nameof(AllocationRule), rule.Id, user,
                new { rule.Name, MatchType = rule.MatchType.ToString(), rule.MatchText });
            await db.SaveChangesAsync(ct);

            return Results.Created($"/api/v1/allocation-rules/{rule.Id}", new { rule.Id, rule.Name });
        });

        group.MapPost("/allocation-rules/{ruleId:guid}/test", async (Guid ruleId,
            ClaimsPrincipal principal, IEntityAccessService access, IAllocationRuleEngine rules,
            IAccountingDbContext db, CancellationToken ct) =>
        {
            var entityId = await db.AllocationRules.AsNoTracking()
                .Where(r => r.Id == ruleId).Select(r => (Guid?)r.EntityId).FirstOrDefaultAsync(ct);
            if (entityId is null) return Results.NotFound();
            if (await access.ResolveAsync(principal, entityId.Value, ct) is null) return Results.Forbid();

            var matches = await rules.TestAsync(ruleId, ct);
            return Results.Ok(matches.Select(t => new
            {
                t.Id, t.TransactionDate, t.Amount, t.Description, t.Status,
            }));
        });

        group.MapGet("/bank-accounts/{bankAccountId:guid}/transactions", async (Guid bankAccountId,
            BankTransactionStatus? status, ClaimsPrincipal principal, IEntityAccessService access,
            IAccountingDbContext db, CancellationToken ct) =>
        {
            if (await ResolveForBankAccountAsync(bankAccountId, principal, access, db, ct) is null)
                return Results.Forbid();

            var query = db.BankTransactions.AsNoTracking().Where(t => t.BankAccountId == bankAccountId);
            if (status is { } wanted) query = query.Where(t => t.Status == wanted);

            var transactions = await query
                .OrderByDescending(t => t.TransactionDate).ThenBy(t => t.SourceRowNumber)
                .Select(t => new
                {
                    t.Id, t.TransactionDate, t.Amount, t.StatementBalance, t.Description, t.Detail,
                    t.Status, t.JournalId, t.SourceRowNumber, t.ImportBatchId,
                })
                .ToListAsync(ct);
            return Results.Ok(transactions);
        });
    }

    private static async Task<UserContext?> ResolveForBankAccountAsync(Guid bankAccountId,
        ClaimsPrincipal principal, IEntityAccessService access, IAccountingDbContext db,
        CancellationToken ct)
    {
        var entityId = await db.BankAccounts.AsNoTracking()
            .Where(a => a.Id == bankAccountId).Select(a => (Guid?)a.EntityId).FirstOrDefaultAsync(ct);
        return entityId is null ? null : await access.ResolveAsync(principal, entityId.Value, ct);
    }
}
