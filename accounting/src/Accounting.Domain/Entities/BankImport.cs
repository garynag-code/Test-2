using System.ComponentModel.DataAnnotations;
using Accounting.Domain.Enums;

namespace Accounting.Domain.Entities;

/// <summary>
/// One statement file offered for import. Retains the source file name and hash so every imported
/// line can be traced back to the file it came from (INV-006).
/// </summary>
public class BankImportBatch
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EntityId { get; set; }
    public Guid BankAccountId { get; set; }
    public BankAccount? BankAccount { get; set; }

    [MaxLength(260)] public required string SourceFileName { get; set; }
    /// <summary>SHA-256 of the file as supplied, used to detect a re-import (BNK-AC-001).</summary>
    [MaxLength(64)] public required string FileHash { get; set; }
    [MaxLength(20)] public required string ParserKey { get; set; }

    public DateOnly? StatementFrom { get; set; }
    public DateOnly? StatementTo { get; set; }

    public int RowCount { get; set; }
    public int ImportedCount { get; set; }
    public int DuplicateCount { get; set; }

    public BankImportStatus Status { get; set; } = BankImportStatus.Committed;

    [MaxLength(450)] public string? ImportedBy { get; set; }
    public DateTime ImportedAtUtc { get; set; } = DateTime.UtcNow;

    public ICollection<BankTransaction> Transactions { get; set; } = [];
}

/// <summary>
/// One line of an imported statement. The original description and row number are never altered,
/// so the ledger entry can always be traced to the statement line that produced it (INV-006).
/// </summary>
public class BankTransaction
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EntityId { get; set; }
    public Guid BankAccountId { get; set; }
    public Guid ImportBatchId { get; set; }
    public BankImportBatch? ImportBatch { get; set; }

    public DateOnly TransactionDate { get; set; }

    /// <summary>Signed as the bank states it: negative is money out, positive is money in.</summary>
    public decimal Amount { get; set; }

    /// <summary>Running balance from the statement, where the format supplies one.</summary>
    public decimal? StatementBalance { get; set; }

    [MaxLength(500)] public required string Description { get; set; }
    /// <summary>Second detail field some formats carry beside the description.</summary>
    [MaxLength(200)] public string? Detail { get; set; }

    public int SourceRowNumber { get; set; }

    /// <summary>
    /// Position of this line among identical lines for the same account, date, amount and description.
    /// Two genuinely identical transactions on one day are distinguished by this ordinal, so neither is
    /// mistaken for a duplicate of the other.
    /// </summary>
    public int DuplicateOrdinal { get; set; }

    public BankTransactionStatus Status { get; set; } = BankTransactionStatus.Unallocated;

    /// <summary>The journal this line was posted through, once allocated (INV-007).</summary>
    public Guid? JournalId { get; set; }

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}
