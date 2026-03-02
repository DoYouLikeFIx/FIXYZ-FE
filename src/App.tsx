import { useCallback, useState } from 'react';

import { getErrorMessage } from '@/lib/errors';
import { fetchHealth } from '@/lib/health';
import type { HealthResponse } from '@/types/health';

type LoadState = 'idle' | 'loading' | 'success' | 'error';

export default function App() {
  const [state, setState] = useState<LoadState>('idle');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleHealthCheck = useCallback(async () => {
    setState('loading');
    setErrorMessage(null);

    try {
      const response = await fetchHealth();
      setHealth(response);
      setState('success');
    } catch (error) {
      setHealth(null);
      setErrorMessage(getErrorMessage(error));
      setState('error');
    }
  }, []);

  return (
    <main className="app-shell">
      <section className="card">
        <h1>Frontend Foundation Scaffold</h1>
        <p>
          Validate API wiring by checking backend health through the shared axios client.
        </p>
        <button
          type="button"
          onClick={handleHealthCheck}
          disabled={state === 'loading'}
          data-testid="health-check-btn"
        >
          {state === 'loading' ? 'Checking...' : 'Check API health'}
        </button>

        {health && (
          <p data-testid="health-result" className="success" role="status">
            API status: {health.status}
          </p>
        )}

        {errorMessage && (
          <p data-testid="error-message" className="error" role="alert">
            {errorMessage}
          </p>
        )}
      </section>
    </main>
  );
}
