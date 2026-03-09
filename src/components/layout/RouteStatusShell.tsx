interface RouteStatusShellProps {
  kicker?: string;
  title: string;
  description: string;
}

export function RouteStatusShell({
  kicker = 'Session check',
  title,
  description,
}: RouteStatusShellProps) {
  return (
    <main className="status-shell" aria-busy="true">
      <section className="status-card">
        <p className="status-kicker">{kicker}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </section>
    </main>
  );
}
