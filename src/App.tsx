function App() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Systems · Infrastructure · Cybersecurity</p>
          <h1>DeadlockZero</h1>
          <p className="lede">
            Distributed concurrency and incident forensics workbench.
          </p>
        </div>
        <span className="status-pill">Engine ready</span>
      </header>

      <section className="workbench-card" aria-label="Workbench status">
        <div>
          <p className="card-label">Wait-for graph</p>
          <h2>Awaiting an incident snapshot</h2>
          <p className="muted">
            Graph ingestion and forensic timelines will appear here as the
            engine grows.
          </p>
        </div>
        <div className="metric-grid">
          <div>
            <span className="metric-value">0</span>
            <span className="metric-label">Threads</span>
          </div>
          <div>
            <span className="metric-value">0</span>
            <span className="metric-label">Resources</span>
          </div>
          <div>
            <span className="metric-value">0</span>
            <span className="metric-label">Cycles</span>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
