import { useEffect, useState } from 'react';
import { api, type Account, type EntitySummary, type TrialBalance } from './api';
import { TrialBalanceView } from './TrialBalanceView';
import { JournalEntryForm } from './JournalEntryForm';

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
      const [loadedAccounts, tb] = await Promise.all([
        api.accounts(entityId),
        api.trialBalance(entityId, fromDate, toDate),
      ]);
      setAccounts(loadedAccounts);
      setTrialBalance(tb);
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
              <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
            </label>
            <button onClick={refresh} disabled={busy}>
              {busy ? 'Loading…' : 'Refresh'}
            </button>
            {trialBalance && <TrialBalanceView trialBalance={trialBalance} />}
          </section>
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
          } catch {
            // The server does not disclose which credential was wrong.
            onError('Sign-in failed. Check your email address and password.');
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
