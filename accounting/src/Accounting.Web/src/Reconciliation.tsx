import { useState } from 'react';
import { api, type BankAccountSummary, type ReconciliationView } from './api';

const money = new Intl.NumberFormat('en-ZA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function Reconciliation({
  bankAccounts,
  onError,
}: {
  bankAccounts: BankAccountSummary[];
  onError: (message: string) => void;
}) {
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? '');
  const [statementDate, setStatementDate] = useState('2026-09-30');
  const [statementBalance, setStatementBalance] = useState('');
  const [view, setView] = useState<ReconciliationView | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (bankAccounts.length === 0) {
    return <p className="status">Add a bank account in the Cashbook before reconciling.</p>;
  }

  return (
    <>
      <section>
        <h2>Reconcile a bank account</h2>
        <label>
          Bank account
          <select value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}>
            {bankAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Statement date
          <input
            type="date"
            value={statementDate}
            onChange={(event) => setStatementDate(event.target.value)}
          />
        </label>
        <label>
          Closing balance per statement
          <input
            inputMode="decimal"
            value={statementBalance}
            placeholder="0.00"
            onChange={(event) => setStatementBalance(event.target.value)}
          />
        </label>
        <button
          disabled={busy || statementBalance.trim() === ''}
          onClick={() =>
            run(async () =>
              setView(
                await api.startReconciliation(
                  bankAccountId,
                  statementDate,
                  Number(statementBalance),
                ),
              ),
            )
          }
        >
          {busy ? 'Working…' : 'Start reconciliation'}
        </button>
      </section>

      {view && (
        <section>
          <h2>Reconciliation at {view.statementDate}</h2>

          <table>
            <tbody>
              <tr>
                <td>Balance per ledger</td>
                <td className="amount">{money.format(view.ledgerBalance)}</td>
              </tr>
              <tr>
                <td>Add: imported but not yet allocated</td>
                <td className="amount">{money.format(view.unallocatedTotal)}</td>
              </tr>
              <tr>
                <td>Less: entries not yet on the statement</td>
                <td className="amount">{money.format(-view.outstandingTotal)}</td>
              </tr>
              <tr>
                <th>Expected balance per statement</th>
                <th className="amount">{money.format(view.expectedStatementBalance)}</th>
              </tr>
              <tr>
                <td>Actual balance per statement</td>
                <td className="amount">{money.format(view.statementBalance)}</td>
              </tr>
              <tr>
                <th>Unexplained difference</th>
                <th className="amount">{money.format(view.unexplainedDifference)}</th>
              </tr>
            </tbody>
          </table>

          {view.unexplainedLedgerItems.length > 0 && (
            <>
              <h3>Ledger entries with no matching bank line</h3>
              <p className="status">
                Each must be explained — typically a payment not yet presented — before the
                reconciliation can be finalised.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th className="amount">Amount</th>
                    <th>Explanation</th>
                  </tr>
                </thead>
                <tbody>
                  {view.unexplainedLedgerItems.map((item) => (
                    <ExplainRow
                      key={item.id}
                      item={item}
                      onExplain={(explanation) =>
                        run(async () =>
                          setView(
                            await api.explainReconciliation(
                              view.reconciliationId,
                              item.id,
                              explanation,
                            ),
                          ),
                        )
                      }
                    />
                  ))}
                </tbody>
              </table>
            </>
          )}

          {view.outstandingLedgerItems.length > 0 && (
            <>
              <h3>Explained as not yet presented</h3>
              <table>
                <tbody>
                  {view.outstandingLedgerItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.date}</td>
                      <td>{item.description}</td>
                      <td className="amount">{money.format(item.amount)}</td>
                      <td>{item.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {view.unallocatedBankItems.length > 0 && (
            <>
              <h3>Imported but not yet allocated</h3>
              <table>
                <tbody>
                  {view.unallocatedBankItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.date}</td>
                      <td>{item.description}</td>
                      <td className="amount">{money.format(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {view.status === 'Final' ? (
            <p className="status">This reconciliation is final and can no longer be changed.</p>
          ) : (
            <>
              <button
                disabled={busy || !view.canFinalise}
                onClick={() =>
                  run(async () =>
                    setView(await api.finaliseReconciliation(view.reconciliationId)),
                  )
                }
              >
                Finalise reconciliation
              </button>
              {!view.canFinalise && (
                <p className="status">
                  A reconciliation can only be finalised when the unexplained difference is exactly
                  zero.
                </p>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}

function ExplainRow({
  item,
  onExplain,
}: {
  item: { id: string; date: string; amount: number; description: string };
  onExplain: (explanation: string) => void;
}) {
  const [explanation, setExplanation] = useState('');

  return (
    <tr>
      <td>{item.date}</td>
      <td>{item.description}</td>
      <td className="amount">{money.format(item.amount)}</td>
      <td>
        <input
          placeholder="Not yet presented because…"
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
        />
        <button disabled={explanation.trim() === ''} onClick={() => onExplain(explanation)}>
          Explain
        </button>
      </td>
    </tr>
  );
}
