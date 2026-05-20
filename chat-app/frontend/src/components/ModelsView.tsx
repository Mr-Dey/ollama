import React, { useState, useEffect, useCallback } from 'react';
import { formatBytes } from '../lib/helpers';

export default function ModelsView({
  activeModel,
  onSelect,
  token,
  isAdmin,
}: {
  activeModel: string;
  onSelect: (m: string) => void;
  token: string;
  isAdmin: boolean;
}) {
  const [models, setModels]               = useState<{ name: string; size: number }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [pullName, setPullName]           = useState('');
  const [pullStatus, setPullStatus]       = useState('');
  const [pullProgress, setPullProgress]   = useState(0);
  const [pullBytes, setPullBytes]         = useState({ done: 0, total: 0 });
  const [pulling, setPulling]             = useState(false);
  const [pullError, setPullError]         = useState('');

  const fetchModels = useCallback(() => {
    setModelsLoading(true);
    fetch(`/api/models`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setModels(data); })
      .catch(() => {})
      .finally(() => setModelsLoading(false));
  }, [token]);

  useEffect(() => { fetchModels(); }, [fetchModels]);

  const startPull = useCallback(async () => {
    const name = pullName.trim();
    if (!name || pulling) return;
    setPulling(true);
    setPullError('');
    setPullStatus('starting…');
    setPullProgress(0);
    setPullBytes({ done: 0, total: 0 });

    try {
      const res = await fetch(`/api/models/pull?model=${encodeURIComponent(name)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const evt of events) {
          const line = evt.split('\n').find(l => l.startsWith('data: '));
          if (!line) continue;
          try {
            const obj = JSON.parse(line.slice(6));
            if (obj.error) throw new Error(obj.error);
            if (obj.status) setPullStatus(obj.status);
            if (typeof obj.total === 'number' && typeof obj.completed === 'number' && obj.total > 0) {
              setPullProgress(Math.round((obj.completed / obj.total) * 100));
              setPullBytes({ done: obj.completed, total: obj.total });
            }
          } catch (e) {
            if (e instanceof Error) throw e;
          }
        }
      }
      setPullStatus('done');
      setPullProgress(100);
      fetchModels();
      setTimeout(() => { setPulling(false); setPullName(''); setPullStatus(''); setPullProgress(0); }, 1500);
    } catch (err) {
      setPullError(err instanceof Error ? err.message : 'Pull failed');
      setPulling(false);
    }
  }, [pullName, pulling, token, fetchModels]);

  const deleteModel = useCallback(async (name: string) => {
    if (!window.confirm(`Delete model "${name}"? This frees disk space but the model will need to be pulled again.`)) return;
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      fetchModels();
    } catch (err) {
      alert('Delete failed: ' + (err instanceof Error ? err.message : 'unknown'));
    }
  }, [token, fetchModels]);

  return (
    <div className="cluster-view">
      <div className="cluster-head">
        <div>
          <div className="crumb">k3s-cluster / models</div>
          <h2>Models</h2>
        </div>
      </div>

      {isAdmin && (
        <>
          <div className="section-head">Pull a new model</div>
          <div className="pull-row">
            <input
              type="text"
              className="pull-input"
              placeholder="e.g. qwen3:14b, llama3.2:1b, mistral:7b"
              value={pullName}
              onChange={e => setPullName(e.target.value)}
              disabled={pulling}
              onKeyDown={e => { if (e.key === 'Enter') startPull(); }}
            />
            <button className="pull-btn" onClick={startPull} disabled={pulling || !pullName.trim()}>
              {pulling ? 'Pulling…' : 'Pull'}
            </button>
          </div>
          {(pulling || pullError) && (
            <div className="pull-progress">
              {pullError ? (
                <div className="pull-error">✗ {pullError}</div>
              ) : (
                <>
                  <div className="pull-bar">
                    <div className="pull-bar-fill" style={{ width: `${pullProgress}%` }} />
                  </div>
                  <div className="pull-meta">
                    <span>{pullStatus}</span>
                    <span>
                      {pullBytes.total > 0
                        ? `${formatBytes(pullBytes.done)} / ${formatBytes(pullBytes.total)} (${pullProgress}%)`
                        : `${pullProgress}%`}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      <div className="section-head">Available models</div>
      {modelsLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          Loading models…
        </div>
      ) : models.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          No models found on the cluster.
        </div>
      ) : (
        <div className="pod-table-wrap">
          <table className="pod-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Status</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {models.map(m => (
                <tr key={m.name}>
                  <td className={`pod-name${m.name === activeModel ? ' model' : ''}`}
                      onClick={() => onSelect(m.name)} style={{ cursor: 'pointer' }}>
                    {m.name}
                  </td>
                  <td>{formatBytes(m.size)}</td>
                  <td>
                    <span className="badge">
                      <span className="dot" />
                      {m.name === activeModel ? 'active' : 'ready'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="icon-btn"
                        style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)' }}
                        onClick={(e) => { e.stopPropagation(); deleteModel(m.name); }}
                        title="Delete model"
                      >
                        delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
