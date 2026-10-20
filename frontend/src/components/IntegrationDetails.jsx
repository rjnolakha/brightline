import MetricCard from './MetricCard.jsx';
import ErrorBreakdown from './ErrorBreakdown.jsx';

export default function IntegrationDetails({ health, logs, history = [], onClose }) {
  if (!health) return <aside className="detail-panel"><div className="detail-empty"><span className="eyebrow">INTEGRATION DETAIL</span><h3>Select an integration</h3><p>Choose a row to inspect its policy, failures, and recent sanitized requests.</p></div></aside>;
  const { integration, metrics, status, reasons, policy } = health;
  return (
    <aside className="detail-panel">
      <header className="detail-heading"><div><span className="eyebrow">INTEGRATION DETAIL</span><h3>{integration.name}</h3></div><button className="close-detail" onClick={onClose} aria-label="Close details">×</button></header>
      <span className={`status-pill status-${status.toLowerCase()}`}><i />{status}</span>
      <div className="detail-metrics">
        <MetricCard label="Total requests" value={metrics.totalRequests} />
        <MetricCard label="Successful" value={metrics.successfulRequests} />
        <MetricCard label="Failed" value={metrics.failedRequests} />
        <MetricCard label="Avg latency" value={metrics.averageLatencyMs === null ? '—' : `${Math.round(metrics.averageLatencyMs)} ms`} />
        <MetricCard label="Max latency" value={metrics.maxLatencyMs === null ? '—' : `${Math.round(metrics.maxLatencyMs)} ms`} />
        <MetricCard label="Last success" value={metrics.lastSuccessfulRequestAt ? new Date(metrics.lastSuccessfulRequestAt).toLocaleString() : 'Never'} />
      </div>
      <h4>Health reasons</h4><ul className="reason-list">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      <h4>Active policy</h4>
      <p className="policy-line">Warning / critical error rate: {policy.errorRateWarningPercent}% / {policy.errorRateCriticalPercent}%</p>
      <p className="policy-line">Warning / critical P95: {policy.p95WarningMs} / {policy.p95CriticalMs} ms</p>
      <p className="policy-line">Minimum request volume: {policy.minimumRequestCount}</p>
      <h4>Failure breakdown</h4><ErrorBreakdown breakdown={metrics.failureBreakdown} />
      <h4>Health trend</h4>
      {history.length ? <div className="history-trend" aria-label="Recent health evaluation history">{history.slice(0, 12).reverse().map((item) => <div key={item.evaluatedAt} title={`${item.status} at ${new Date(item.evaluatedAt).toLocaleString()}`}><span className={`trend-mark status-${item.status.toLowerCase()}`} /><small>{new Date(item.evaluatedAt).toLocaleTimeString()}</small></div>)}</div> : <p className="muted">No scheduled health snapshots yet.</p>}
      <h4>Recent requests</h4>
      <div className="recent-logs">{(logs || []).map((log) => <div className="log-row" key={log.id}><span className={`log-outcome ${log.outcome}`}>{log.statusCode ?? log.outcome}</span><code>{log.method} {log.endpoint}</code><time>{log.durationMs === null ? '—' : `${Math.round(log.durationMs)} ms`}</time></div>)}
        {!logs?.length && <p className="muted">No request records available.</p>}
      </div>
    </aside>
  );
}
