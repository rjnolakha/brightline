const statusItems = [
  ['HEALTHY', 'Healthy'], ['DEGRADED', 'Degraded'], ['UNHEALTHY', 'Unhealthy'], ['UNKNOWN', 'Unknown']
];

export default function StatusSummary({ counts = {} }) {
  return <div className="status-summary">{statusItems.map(([key, label]) => (
    <div className={`count-card count-${key.toLowerCase()}`} key={key}>
      <span className="status-dot" aria-hidden="true" /><span>{label}</span><strong>{counts[key] ?? 0}</strong>
    </div>
  ))}</div>;
}
