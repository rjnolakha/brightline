export default function ErrorBreakdown({ breakdown = { byStatus: {}, byCategory: {} } }) {
  const groups = [['HTTP status', breakdown.byStatus || {}], ['Error category', breakdown.byCategory || {}]];
  return <div className="breakdown-grid">{groups.map(([title, entries]) => (
    <div key={title}><h4>{title}</h4>{Object.keys(entries).length ? Object.entries(entries).map(([name, count]) => <p key={name}><span>{name.replaceAll('_', ' ')}</span><strong>{count}</strong></p>) : <p className="muted">No failures in the active window.</p>}</div>
  ))}</div>;
}
