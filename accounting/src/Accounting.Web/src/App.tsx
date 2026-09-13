import { useEffect, useState } from 'react';
import {
  api,
  ApiUnreachableError,
  type Account,
  type BankAccountSummary,
  type EntitySummary,
  type TrialBalance,
} from './api';
import { TrialBalanceView } from './TrialBalanceView';
import { JournalEntryForm } from './JournalEntryForm';
import { Cashbook } from './Cashbook';
import { Reconciliation } from './Reconciliation';

type Tab = 'journals' | 'cashbook' | 'reconciliation';

export function App() {
  const [signedIn, setSignedIn] = useState(api.signedIn);
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [entityId, setEntityId] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [trialBalance, setTrialBalance] = useState<TrialBalance | null>(null);
  const [fromDate, setFromDate] = useState('2026-03-01');
  const [toDate, setToDate] = useState('2027-02-28');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('journals');
  const [bankAccounts, setBankAccounts] = useState<BankAccountSummary[]>([]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!signedIn) return;
    run(async () => {
      const loaded = await api.entities();
      setEntities(loaded);
      setEntityId((current) => current || loaded[0]?.id || '');
    });
  }, [signedIn]);

  const refresh = () =>
    run(async () => {
      if (!entityId) return;
      const [loadedAccounts, tb, banks] = await Promise.all([
        api.accounts(entityId),
        api.trialBalance(entityId, fromDate, toDate),
        api.bankAccounts(entityId),
      ]);
      setAccounts(loadedAccounts);
      setTrialBalance(tb);
      setBankAccounts(banks);
    });

  useEffect(() => {
    if (entityId) refresh();
  }, [entityId]);

  if (!signedIn) {
    return <SignIn onSignedIn={() => setSignedIn(true)} onError={setError} error={error} />;
  }

  return (
    <main>
      <h1>Local Accounting Platform</h1>

      <section>
        <label>
          Entity
          <select value={entityId} onChange={(event) => setEntityId(event.target.value)}>
            <option value="">Select an entity</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.legalName}
              </option>
            ))}
          </select>
        </label>
        {entities.length === 0 && !busy && (
          <p className="status">No entities are available to your user account.</p>
        )}
      </section>

      {error && <p className="error">{error}</p>}

      {entityId && (
        <>
          <nav>
            {(['journals', 'cashbook', 'reconciliation'] as Tab[]).map((name) => (
              <button
                key={name}
                onClick={() => {
                  setTab(name);
                  setError(null);
                }}
                aria-current={tab === name}
              >
                {name === 'journals' ? 'Journals' : name === 'cashbook' ? 'Cashbook' : 'Reconciliation'}
              </button>
            ))}
          </nav>

          {tab === 'journals' && (
            <>
              <section>
                <h2>Journal entry</h2>
                <JournalEntryForm
                  entityId={entityId}
                  accounts={accounts.filter((account) => account.postingAllowed)}
                  onPosted={refresh}
                  onError={setError}
                />
              </section>

              <section>
                <h2>Trial balance</h2>
                <label>
                  From
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(event) => setFromDate(event.target.value)}
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    value={toDate}
                    onChange={(event) => setToDate(event.target.value)}
                  />
                </label>
                <button onClick={refresh} disabled={busy}>
                  {busy ? 'Loading…' : 'Refresh'}
                </button>
                {trialBalance && <TrialBalanceView trialBalance={trialBalance} />}
              </section>
            </>
          )}

          {tab === 'cashbook' && (
            <Cashbook
              entityId={entityId}
              accounts={accounts}
              onError={setError}
              onPosted={refresh}
            />
          )}

          {tab === 'reconciliation' && (
            <Reconciliation bankAccounts={bankAccounts} onError={setError} />
          )}
        </>
      )}
    </main>
  );
}

function SignIn({
  onSignedIn,
  onError,
  error,
}: {
  onSignedIn: () => void;
  onError: (message: string) => void;
  error: string | null;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <main>
      <h1>Sign in</h1>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await api.signIn(email, password);
            onSignedIn();
          } catch (failure) {
            // Distinguish a service that is not running from credentials that were refused;
            // the server itself never discloses which credential was wrong.
            onError(
              failure instanceof ApiUnreachableError
                ? failure.message
                : 'Sign-in failed. Check your email address and password.',
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Email
          <input
            type="email"
            value={email}
            autoComplete="username"
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
