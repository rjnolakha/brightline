function display(value, suffix = '') {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100) / 100}${suffix}`;
}

export default function IntegrationTable({ integrations = [], selectedId, onSelect }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Integration</th><th>Status</th><th>Requests</th><th>Error rate</th><th>P95 latency</th><th>Last request</th><th>Freshness</th></tr></thead>
        <tbody>{integrations.map(({ integration, status, reasons, metrics }) => (
          <tr key={integration.id} onClick={() => onSelect(integration.id)} className={selectedId === integration.id ? 'selected-row' : ''} tabIndex="0" onKeyDown={(event) => event.key === 'Enter' && onSelect(integration.id)}>
            <td><button className="integration-name" onClick={(event) => { event.stopPropagation(); onSelect(integration.id); }} onKeyDown={(event) => event.stopPropagation()}>{integration.name}<small>{integration.critical ? 'Critical' : 'Standard'}</small></button></td>
            <td><span className={`status-pill status-${status.toLowerCase()}`}><i />{status}</span><small className="reason">{reasons[0]}</small></td>
            <td>{metrics.totalRequests}</td>
            <td>{display(metrics.errorRatePercent, '%')}</td>
            <td>{display(metrics.p95LatencyMs, ' ms')}</td>
            <td>{metrics.lastRequestAt ? new Date(metrics.lastRequestAt).toLocaleString() : 'Never'}</td>
            <td><span className={`freshness freshness-${metrics.freshness}`}>{metrics.freshness.replace('_', ' ')}</span></td>
          </tr>
        ))}</tbody>
      </table>
      {!integrations.length && <p className="empty-note">No integration definitions are available.</p>}
    </div>
  );
}
