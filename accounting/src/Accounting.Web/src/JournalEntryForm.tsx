import { useState } from 'react';
import { api, type Account } from './api';

type LineDraft = { accountId: string; debit: string; credit: string };

const emptyLines: LineDraft[] = [
  { accountId: '', debit: '', credit: '' },
  { accountId: '', debit: '', credit: '' },
];

const parse = (value: string) => (value.trim() === '' ? 0 : Number(value));

export function JournalEntryForm({
  entityId,
  accounts,
  onPosted,
  onError,
}: {
  entityId: string;
  accounts: Account[];
  onPosted: () => void;
  onError: (message: string) => void;
}) {
  const [transactionDate, setTransactionDate] = useState('2026-06-30');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(emptyLines);
  const [busy, setBusy] = useState(false);
  const [postedJournal, setPostedJournal] = useState<{ id: string; number: string } | null>(null);

  const totalDebit = lines.reduce((sum, line) => sum + parse(line.debit), 0);
  const totalCredit = lines.reduce((sum, line) => sum + parse(line.credit), 0);
  // Display only. The posting service is the authority on whether a journal may post.
  const looksBalanced = totalDebit === totalCredit && totalDebit > 0;

  const update = (index: number, change: Partial<LineDraft>) =>
    setLines(lines.map((line, i) => (i === index ? { ...line, ...change } : line)));

  async function post() {
    setBusy(true);
    try {
      const draft = await api.createDraft(
        entityId,
        transactionDate,
        description,
        lines
          .filter((line) => line.accountId)
          .map((line) => ({
            accountId: line.accountId,
            debitAmount: parse(line.debit),
            creditAmount: parse(line.credit),
          })),
      );
      const posted = await api.postJournal(draft.journalId);
      setPostedJournal({ id: draft.journalId, number: posted.journalNumber });
      setLines(emptyLines);
      setDescription('');
      onPosted();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function reverse() {
    if (!postedJournal) return;
    const reason = window.prompt('Reason for the reversal');
    if (!reason) return;

    setBusy(true);
    try {
      await api.reverseJournal(postedJournal.id, transactionDate, reason);
      setPostedJournal(null);
      onPosted();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label>
        Date
        <input
          type="date"
          value={transactionDate}
          onChange={(event) => setTransactionDate(event.target.value)}
        />
      </label>
      <label>
        Description
        <input value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>

      <table>
        <thead>
          <tr>
            <th>Account</th>
            <th className="amount">Debit</th>
            <th className="amount">Credit</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={index}>
              <td>
                <select
                  value={line.accountId}
                  onChange={(event) => update(index, { accountId: event.target.value })}
                >
                  <option value="">Select an account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} {account.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="amount">
                <input
                  inputMode="decimal"
                  value={line.debit}
                  onChange={(event) => update(index, { debit: event.target.value, credit: '' })}
                />
              </td>
              <td className="amount">
                <input
                  inputMode="decimal"
                  value={line.credit}
                  onChange={(event) => update(index, { credit: event.target.value, debit: '' })}
                />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>Total</th>
            <th className="amount">{totalDebit.toFixed(2)}</th>
            <th className="amount">{totalCredit.toFixed(2)}</th>
          </tr>
        </tfoot>
      </table>

      <button onClick={() => setLines([...lines, { accountId: '', debit: '', credit: '' }])}>
        Add line
      </button>
      <button onClick={post} disabled={busy || !looksBalanced}>
        {busy ? 'Working…' : 'Post journal'}
      </button>

      {postedJournal && (
        <p className="status">
          Posted as {postedJournal.number}.{' '}
          <button onClick={reverse} disabled={busy}>
            Reverse
          </button>
        </p>
      )}
    </>
  );
}
