async function request(path, signal) {
  const response = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || `Request failed (${response.status})`);
  return body.data;
}

export const fetchSummary = (signal) => request('/api/health/summary', signal);
export const fetchIntegration = (id, signal) => request(`/api/integrations/${encodeURIComponent(id)}/health`, signal);
export const fetchLogs = (id, signal) => request(`/api/integrations/${encodeURIComponent(id)}/logs?limit=8`, signal);
export const fetchHistory = (id, signal) => request(`/api/integrations/${encodeURIComponent(id)}/history`, signal);
