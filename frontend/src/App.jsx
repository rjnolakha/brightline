import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowDownToLine, CircleHelp, RefreshCw } from 'lucide-react';
import { fetchHistory, fetchIntegration, fetchLogs, fetchSummary } from './api/apiClient.js';
import OverallHealth from './components/OverallHealth.jsx';
import StatusSummary from './components/StatusSummary.jsx';
import IntegrationTable from './components/IntegrationTable.jsx';
import IntegrationDetails from './components/IntegrationDetails.jsx';

export default function App() {
  const [summary, setSummary] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [logs, setLogs] = useState([]);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState(null);

  const refresh = useCallback(async (signal) => {
    try {
      setError('');
      const next = await fetchSummary(signal);
      setSummary(next);
      setRefreshedAt(new Date().toISOString());
      setLoading(false);
      if (selectedId) {
        const [health, requestLogs, snapshots] = await Promise.all([fetchIntegration(selectedId, signal), fetchLogs(selectedId, signal), fetchHistory(selectedId, signal)]);
        setDetail(health);
        setLogs(requestLogs.logs);
        setHistory(snapshots);
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || 'Unable to load health data.');
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    const timer = setInterval(() => refresh(), 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh]);

  async function selectIntegration(id) {
    setSelectedId(id);
    try {
      const [health, requestLogs, snapshots] = await Promise.all([fetchIntegration(id), fetchLogs(id), fetchHistory(id)]);
      setDetail(health);
      setLogs(requestLogs.logs);
      setHistory(snapshots);
    } catch (err) { setError(err.message); }
  }

  const summaryStale = refreshedAt && Date.now() - Date.parse(refreshedAt) > 90000;
  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="BRIGHTLINE operations home"><span className="brand-mark"><Activity size={20} /></span><span>BRIGHTLINE<small>HR OPERATIONS</small></span></a>
        <div className="topbar-right"><span className="live-indicator"><i />Monitoring</span><button className="refresh-button" onClick={() => refresh()} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} />Refresh</button></div>
      </header>
      <div className="content">
        <section className="page-heading"><div><span className="eyebrow">OPERATIONS CENTER / INTEGRATIONS</span><h1>Integration health</h1><p>Reliability and response performance across your connected services.</p></div><div className="updated-label"><span>Last refreshed</span><strong>{refreshedAt ? new Date(refreshedAt).toLocaleTimeString() : '—'}</strong></div></section>
        {error && <div className="error-banner" role="alert"><CircleHelp size={18} /><span>{error}</span><button onClick={() => refresh()}>Try again</button></div>}
        {summaryStale && <div className="stale-banner" role="status">Dashboard data may be stale. Refresh to retry.</div>}
        {summary?.evaluationStatus === 'degraded' && <div className="stale-banner" role="status">The latest scheduled health evaluation failed; showing the last successful evaluation time.</div>}
        {loading && !summary ? <section className="loading-state" aria-live="polite"><span className="loader" />Loading integration health…</section> : !summary ? <section className="loading-state error-state" role="status">Integration health is unavailable. Use Refresh to retry.</section> : (
          <>
            <OverallHealth status={summary?.overallStatus} evaluatedAt={summary?.evaluatedAt} />
            <section className="summary-section"><div className="section-heading"><div><span className="eyebrow">AT A GLANCE</span><h2>Service overview</h2></div><span className="total-count">{summary?.totalIntegrations ?? 0} integrations</span></div><StatusSummary counts={summary?.statusCounts} /></section>
            <section className="integrations-section"><div className="section-heading"><div><span className="eyebrow">CONNECTED SERVICES</span><h2>All integrations</h2></div><span className="section-note">15 minute rolling health window</span></div><IntegrationTable integrations={summary?.integrations} selectedId={selectedId} onSelect={selectIntegration} /></section>
            <section className="data-note"><ArrowDownToLine size={16} /><span>Health is based on imported request logs. No live customer or employee data is fetched.</span></section>
            <IntegrationDetails health={detail} logs={logs} history={history} onClose={() => { setSelectedId(null); setDetail(null); setHistory([]); }} />
          </>
        )}
      </div>
      <footer>BRIGHTLINE HR <span>•</span> Integration observability <span>•</span> Auto-refresh every 30 seconds</footer>
    </main>
  );
}
