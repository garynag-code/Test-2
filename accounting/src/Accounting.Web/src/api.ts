export type Account = {
  id: string;
  code: string;
  name: string;
  accountType: string;
  postingAllowed: boolean;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const errors: ApiError[] | undefined = body?.errors;
    throw new Error(
      errors?.map((e) => `${e.code}: ${e.message}`).join('\n') ??
        `Request failed with status ${response.status}`,
    );
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

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
};
