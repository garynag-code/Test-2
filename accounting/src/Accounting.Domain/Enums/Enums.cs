namespace Accounting.Domain.Enums;

public enum AccountType { Asset = 1, Liability = 2, Equity = 3, Income = 4, Expense = 5 }

public enum NormalBalance { Debit = 1, Credit = 2 }

public enum ControlAccountType { None = 0, Bank = 1, AccountsReceivable = 2, AccountsPayable = 3, Vat = 4, Tax = 5 }

public enum CurrentNonCurrent { NotApplicable = 0, Current = 1, NonCurrent = 2 }

/// <summary>Specification section 8.3 accounting period state model.</summary>
public enum PeriodStatus { Open = 1, SoftLocked = 2, HardLocked = 3 }

/// <summary>Specification section 8.3 journal state model.</summary>
public enum JournalStatus { Draft = 1, Reviewed = 2, Posted = 3, Reversed = 4, Voided = 5 }

/// <summary>Specification section 11.3 journal types.</summary>
public enum JournalType { GEN = 1, BNK = 2, OB = 3, REV = 4, YE = 5, TAX = 6, SYS = 7 }

public enum VatTreatment { Exempt = 1, Standard = 2, Zero = 3, Custom = 4 }

public enum VatInputOutputMode { Input = 1, Output = 2, Both = 3 }
