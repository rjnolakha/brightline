export default function OverallHealth({ status, evaluatedAt }) {
  return (
    <section className={`overall-panel status-${status?.toLowerCase()}`}>
      <div className="overall-orbit" aria-hidden="true"><span /></div>
      <div className="overall-copy">
        <span className="eyebrow">PLATFORM STATUS</span>
        <h2>{status || 'Loading'}</h2>
        <p>{status === 'UNKNOWN' ? 'Health evidence is not yet sufficient. Import request logs to begin monitoring.' : 'Live health from recent integration activity.'}</p>
        <small>Last evaluated {evaluatedAt ? new Date(evaluatedAt).toLocaleString() : 'not yet evaluated'}</small>
      </div>
    </section>
  );
}
