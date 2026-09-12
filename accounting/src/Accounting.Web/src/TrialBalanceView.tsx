import type { TrialBalance } from './api';

const money = new Intl.NumberFormat('en-ZA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const amount = (value: number) => (value === 0 ? '' : money.format(value));

export function TrialBalanceView({ trialBalance }: { trialBalance: TrialBalance }) {
  if (trialBalance.rows.length === 0) {
    return <p className="status">No posted transactions in this date range.</p>;
  }

  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Account</th>
            <th className="amount">Opening</th>
            <th className="amount">Debit</th>
            <th className="amount">Credit</th>
            <th className="amount">Closing debit</th>
            <th className="amount">Closing credit</th>
          </tr>
        </thead>
        <tbody>
          {trialBalance.rows.map((row) => (
            <tr key={row.accountCode}>
              <td>{row.accountCode}</td>
              <td>{row.accountName}</td>
              <td className="amount">{amount(row.openingBalance)}</td>
              <td className="amount">{amount(row.periodDebit)}</td>
              <td className="amount">{amount(row.periodCredit)}</td>
              <td className="amount">{amount(row.closingDebit)}</td>
              <td className="amount">{amount(row.closingCredit)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={5}>Total</th>
            <th className="amount">{money.format(trialBalance.totalDebit)}</th>
            <th className="amount">{money.format(trialBalance.totalCredit)}</th>
          </tr>
        </tfoot>
      </table>
      <p className="status">
        {trialBalance.isBalanced
          ? 'Trial balance agrees.'
          : 'Trial balance does not agree — investigate before reporting.'}
      </p>
    </>
  );
}
