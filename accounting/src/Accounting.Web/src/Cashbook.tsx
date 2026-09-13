import { useEffect, useState } from 'react';
import {
  api,
  type Account,
  type BankAccountSummary,
  type BankTransactionSummary,
  type ImportPreview,
  type Suggestion,
  type VatCodeSummary,
} from './api';

const money = new Intl.NumberFormat('en-ZA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function Cashbook({
  entityId,
  accounts,
  onError,
  onPosted,
}: {
  entityId: string;
  accounts: Account[];
  onError: (message: string) => void;
  onPosted: () => void;
}) {
  const [bankAccounts, setBankAccounts] = useState<BankAccountSummary[]>([]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [vatCodes, setVatCodes] = useState<VatCodeSummary[]>([]);
  const [transactions, setTransactions] = useState<BankTransactionSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const postingAccounts = accounts.filter((a) => a.postingAllowed);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    run(async () => {
      const [loaded, codes] = await Promise.all([api.bankAccounts(entityId), api.vatCodes(entityId)]);
      setBankAccounts(loaded);
      setVatCodes(codes);
      setBankAccountId((current) => current || loaded[0]?.id || '');
    });
  }, [entityId]);

  const refreshTransactions = () =>
    run(async () => {
      if (!bankAccountId) return;
      setTransactions(await api.bankTransactions(bankAccountId, 'Unallocated'));
    });

  useEffect(() => {
    if (bankAccountId) refreshTransactions();
  }, [bankAccountId]);

  if (bankAccounts.length === 0 && !busy) {
    return (
      <CreateBankAccount
        entityId={entityId}
        accounts={accounts}
        onError={onError}
        onCreated={() =>
          run(async () => {
            const loaded = await api.bankAccounts(entityId);
            setBankAccounts(loaded);
            setBankAccountId(loaded[0]?.id ?? '');
          })
        }
      />
    );
  }

  return (
    <>
      <section>
        <label>
          Bank account
          <select value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}>
            {bankAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.bankKey})
              </option>
            ))}
          </select>
        </label>
      </section>

      {bankAccountId && (
        <>
          <ImportStatement
            bankAccountId={bankAccountId}
            onError={onError}
            onImported={refreshTransactions}
          />

          <section>
            <h2>Unallocated transactions</h2>
            {transactions.length === 0 ? (
              <p className="status">
                {busy ? 'Loading…' : 'Nothing to allocate. Import a statement to begin.'}
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th className="amount">Amount</th>
                    <th>Allocate to</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((transaction) => (
                    <AllocationRow
                      key={transaction.id}
                      transaction={transaction}
                      accounts={postingAccounts}
                      vatCodes={vatCodes}
                      onError={onError}
                      onAllocated={() => {
                        refreshTransactions();
                        onPosted();
                      }}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </>
  );
}

function CreateBankAccount({
  entityId,
  accounts,
  onError,
  onCreated,
}: {
  entityId: string;
  accounts: Account[];
  onError: (message: string) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('FNB Business Cheque');
  const [bankKey, setBankKey] = useState('FNB');
  const [accountNumber, setAccountNumber] = useState('');
  const [ledgerAccountId, setLedgerAccountId] = useState('');
  const [busy, setBusy] = useState(false);

  // Only a bank control account may back a bank account; the server enforces this too.
  const bankControlAccounts = accounts.filter((a) => a.controlAccountType === 'Bank');

  useEffect(() => {
    setLedgerAccountId((current) => current || bankControlAccounts[0]?.id || '');
  }, [accounts]);

  return (
    <section>
      <h2>Add a bank account</h2>
      <p className="status">No bank account is set up for this entity yet.</p>
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Bank
        <select value={bankKey} onChange={(event) => setBankKey(event.target.value)}>
          <option value="FNB">FNB</option>
        </select>
      </label>
      <label>
        Account number
        <input value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} />
      </label>
      <label>
        Ledger account
        <select
          value={ledgerAccountId}
          onChange={(event) => setLedgerAccountId(event.target.value)}
        >
          {bankControlAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.code} {account.name}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={busy || !name || !ledgerAccountId}
        onClick={async () => {
          setBusy(true);
          try {
            await api.createBankAccount(entityId, {
              name,
              bankKey,
              accountNumber: accountNumber || undefined,
              ledgerAccountId,
            });
            onCreated();
          } catch (failure) {
            onError(failure instanceof Error ? failure.message : String(failure));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Saving…' : 'Add bank account'}
      </button>
    </section>
  );
}

function ImportStatement({
  bankAccountId,
  onError,
  onImported,
}: {
  bankAccountId: string;
  onError: (message: string) => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);

  async function attempt(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Import a statement</h2>
      <input
        type="file"
        accept=".csv"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setPreview(null);
        }}
      />
      <button
        disabled={!file || busy}
        onClick={() => attempt(async () => setPreview(await api.previewImport(bankAccountId, file!)))}
      >
        {busy ? 'Reading…' : 'Preview'}
      </button>

      {preview && (
        <>
          <p className="status">
            {preview.parserKey} · {preview.newCount} new, {preview.duplicateCount} already imported
          </p>

          {preview.fileAlreadyImported && (
            <p className="error">
              This exact file was imported on{' '}
              {new Date(preview.previouslyImportedAtUtc!).toLocaleString()}. Importing it again will
              add only lines that are genuinely new.
            </p>
          )}

          {preview.errors.map((e) => (
            <p key={e.code + e.message} className="error">
              {e.message}
            </p>
          ))}
          {preview.warnings.map((w) => (
            <p key={w.code + w.message} className="status">
              Warning: {w.message}
            </p>
          ))}

          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="amount">Amount</th>
                <th className="amount">Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((line) => (
                <tr key={line.rowNumber} className={line.isDuplicate ? 'muted' : undefined}>
                  <td>{line.transactionDate}</td>
                  <td>{line.description}</td>
                  <td className="amount">{money.format(line.amount)}</td>
                  <td className="amount">
                    {line.balance === undefined ? '' : money.format(line.balance)}
                  </td>
                  <td>{line.isDuplicate ? 'Already imported' : 'New'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            disabled={busy || preview.newCount === 0}
            onClick={() =>
              attempt(async () => {
                const result = await api.commitImport(
                  bankAccountId,
                  file!,
                  preview.fileAlreadyImported,
                );
                setPreview(null);
                setFile(null);
                onImported();
                onError(
                  `Imported ${result.importedCount} transactions` +
                    (result.duplicateCount > 0
                      ? `, skipping ${result.duplicateCount} already held.`
                      : '.'),
                );
              })
            }
          >
            {busy ? 'Importing…' : `Import ${preview.newCount} transactions`}
          </button>
        </>
      )}
    </section>
  );
}

function AllocationRow({
  transaction,
  accounts,
  vatCodes,
  onError,
  onAllocated,
}: {
  transaction: BankTransactionSummary;
  accounts: Account[];
  vatCodes: VatCodeSummary[];
  onError: (message: string) => void;
  onAllocated: () => void;
}) {
  const [accountId, setAccountId] = useState('');
  const [vatCodeId, setVatCodeId] = useState('');
  const [noVatReason, setNoVatReason] = useState('');
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .suggestion(transaction.id)
      .then((found) => {
        if (cancelled || !found) return;
        setSuggestion(found);
        setAccountId((current) => current || found.accountId);
        setVatCodeId((current) => current || found.vatCodeId || '');
      })
      .catch(() => {
        // A missing suggestion is not an error worth interrupting the user for.
      });
    return () => {
      cancelled = true;
    };
  }, [transaction.id]);

  // The user departed from what the rule proposed, so the rule should lose confidence.
  const overrode =
    suggestion !== null &&
    (accountId !== suggestion.accountId || vatCodeId !== (suggestion.vatCodeId ?? ''));

  return (
    <tr>
      <td>{transaction.transactionDate}</td>
      <td>
        {transaction.description}
        {suggestion && (
          <div className="status">
            Suggested by rule “{suggestion.ruleName}” ({suggestion.matchType}:{' '}
            {suggestion.matchExpression})
          </div>
        )}
      </td>
      <td className="amount">{money.format(transaction.amount)}</td>
      <td>
        <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
          <option value="">Select an account</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.code} {account.name}
            </option>
          ))}
        </select>
        <select value={vatCodeId} onChange={(event) => setVatCodeId(event.target.value)}>
          <option value="">No VAT</option>
          {vatCodes.map((code) => (
            <option key={code.id} value={code.id}>
              {code.code} {code.description}
            </option>
          ))}
        </select>
        {vatCodeId === '' && (
          <input
            placeholder="Reason for no VAT"
            value={noVatReason}
            onChange={(event) => setNoVatReason(event.target.value)}
          />
        )}
        <button
          disabled={busy || !accountId}
          onClick={async () => {
            setBusy(true);
            try {
              await api.allocate(
                transaction.id,
                [
                  {
                    accountId,
                    grossAmount: Math.abs(transaction.amount),
                    vatCodeId: vatCodeId || undefined,
                    noVatReason: vatCodeId ? undefined : noVatReason || undefined,
                  },
                ],
                suggestion && !overrode ? suggestion.ruleId : undefined,
                suggestion && overrode ? suggestion.ruleId : undefined,
              );
              onAllocated();
            } catch (failure) {
              onError(failure instanceof Error ? failure.message : String(failure));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Posting…' : 'Allocate'}
        </button>
      </td>
    </tr>
  );
}
