export type Account = {
  id: string;
  code: string;
  name: string;
  accountType: string;
  postingAllowed: boolean;
  controlAccountType: string;
};

export type TrialBalanceRow = {
  accountCode: string;
  accountName: string;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
};

export type TrialBalance = {
  fromDate: string;
  toDate: string;
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
  rows: TrialBalanceRow[];
};

export type EntitySummary = { id: string; legalName: string };

export type JournalLineInput = {
  accountId: string;
  debitAmount: number;
  creditAmount: number;
  description?: string;
};

export type ApiError = { code: string; message: string };

let accessToken: string | null = null;

/** Thrown when the API could not be reached at all, as distinct from rejecting the request. */
export class ApiUnreachableError extends Error {
  constructor() {
    super('Could not reach the accounting service. Check that it is running on port 5080.');
    this.name = 'ApiUnreachableError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    // A failed fetch means the service is down or unreachable, not that the request was wrong.
    throw new ApiUnreachableError();
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const errors: ApiError[] | undefined = body?.errors;
    const single = body?.errorCode ? `${body.errorCode}: ${body.message}` : null;
    throw new Error(
      errors?.map((e) => `${e.code}: ${e.message}`).join('\n') ??
        single ??
        body?.message ??
        `Request failed with status ${response.status}`,
    );
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export type BankAccountSummary = {
  id: string;
  name: string;
  bankKey: string;
  accountNumber?: string;
  ledgerAccountCode: string;
};

export type ImportPreviewLine = {
  rowNumber: number;
  transactionDate: string;
  amount: number;
  balance?: number;
  description: string;
  isDuplicate: boolean;
  duplicateReason?: string;
};

export type ImportPreview = {
  parserKey: string;
  fileAlreadyImported: boolean;
  previouslyImportedAtUtc?: string;
  newCount: number;
  duplicateCount: number;
  canCommit: boolean;
  errors: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
  lines: ImportPreviewLine[];
};

export type BankTransactionSummary = {
  id: string;
  transactionDate: string;
  amount: number;
  statementBalance?: number;
  description: string;
  status: string;
  journalId?: string;
};

export type Suggestion = {
  ruleId: string;
  ruleName: string;
  matchExpression: string;
  matchType: string;
  accountId: string;
  vatCodeId?: string;
  confidence: number;
};

export type VatCodeSummary = { id: string; code: string; description: string };

export type ReconciliationItem = {
  id: string;
  date: string;
  amount: number;
  description: string;
  explanation?: string;
};

export type ReconciliationView = {
  reconciliationId: string;
  statementDate: string;
  statementBalance: number;
  status: string;
  ledgerBalance: number;
  unallocatedBankItems: ReconciliationItem[];
  outstandingLedgerItems: ReconciliationItem[];
  unexplainedLedgerItems: ReconciliationItem[];
  unallocatedTotal: number;
  outstandingTotal: number;
  expectedStatementBalance: number;
  unexplainedDifference: number;
  canFinalise: boolean;
};

export const api = {
  async signIn(email: string, password: string): Promise<void> {
    const result = await request<{ accessToken: string }>('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    accessToken = result.accessToken;
  },

  signOut(): void {
    accessToken = null;
  },

  get signedIn(): boolean {
    return accessToken !== null;
  },

  entities: () => request<EntitySummary[]>('/api/v1/entities'),

  accounts: (entityId: string) => request<Account[]>(`/api/v1/entities/${entityId}/accounts`),

  trialBalance: (entityId: string, fromDate: string, toDate: string) =>
    request<TrialBalance>(
      `/api/v1/entities/${entityId}/trial-balance?fromDate=${fromDate}&toDate=${toDate}`,
    ),

  createDraft: (
    entityId: string,
    transactionDate: string,
    description: string,
    lines: JournalLineInput[],
  ) =>
    request<{ journalId: string }>(`/api/v1/entities/${entityId}/journals`, {
      method: 'POST',
      body: JSON.stringify({ transactionDate, journalType: 'GEN', description, lines }),
    }),

  postJournal: (journalId: string) =>
    request<{ journalNumber: string }>(`/api/v1/journals/${journalId}/post`, { method: 'POST' }),

  reverseJournal: (journalId: string, reversalDate: string, reason: string) =>
    request<{ journalNumber: string }>(`/api/v1/journals/${journalId}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ reversalDate, reason }),
    }),

  vatCodes: (entityId: string) =>
    request<VatCodeSummary[]>(`/api/v1/entities/${entityId}/vat-codes`),

  bankAccounts: (entityId: string) =>
    request<BankAccountSummary[]>(`/api/v1/entities/${entityId}/bank-accounts`),

  createBankAccount: (
    entityId: string,
    body: { name: string; bankKey: string; accountNumber?: string; ledgerAccountId: string },
  ) =>
    request<{ id: string }>(`/api/v1/entities/${entityId}/bank-accounts`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  previewImport: (bankAccountId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ImportPreview>(`/api/v1/bank-accounts/${bankAccountId}/imports/preview`, {
      method: 'POST',
      body: form,
    });
  },

  commitImport: (bankAccountId: string, file: File, confirmReimport: boolean) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ batchId: string; importedCount: number; duplicateCount: number }>(
      `/api/v1/bank-accounts/${bankAccountId}/imports?confirmReimport=${confirmReimport}`,
      { method: 'POST', body: form },
    );
  },

  bankTransactions: (bankAccountId: string, status?: string) =>
    request<BankTransactionSummary[]>(
      `/api/v1/bank-accounts/${bankAccountId}/transactions${status ? `?status=${status}` : ''}`,
    ),

  suggestion: (transactionId: string) =>
    request<Suggestion | undefined>(`/api/v1/bank-transactions/${transactionId}/suggestion`),

  allocate: (
    transactionId: string,
    splits: {
      accountId: string;
      grossAmount: number;
      vatCodeId?: string;
      noVatReason?: string;
    }[],
    appliedRuleId?: string,
    overriddenRuleId?: string,
  ) =>
    request<{ journalNumber: string }>(`/api/v1/bank-transactions/${transactionId}/allocate`, {
      method: 'POST',
      body: JSON.stringify({ splits, appliedRuleId, overriddenRuleId }),
    }),

  startReconciliation: (bankAccountId: string, statementDate: string, statementBalance: number) =>
    request<ReconciliationView>(`/api/v1/bank-accounts/${bankAccountId}/reconciliations`, {
      method: 'POST',
      body: JSON.stringify({ statementDate, statementBalance }),
    }),

  explainReconciliation: (reconciliationId: string, journalLineId: string, explanation: string) =>
    request<ReconciliationView>(`/api/v1/reconciliations/${reconciliationId}/explain`, {
      method: 'POST',
      body: JSON.stringify({ journalLineId, explanation }),
    }),

  finaliseReconciliation: (reconciliationId: string) =>
    request<ReconciliationView>(`/api/v1/reconciliations/${reconciliationId}/finalise`, {
      method: 'POST',
    }),
};
