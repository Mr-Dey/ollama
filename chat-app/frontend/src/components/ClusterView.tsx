import React, { useState, useEffect } from 'react';
import { NodeInfo, PodRow } from '../types';

export default function ClusterView({ online, token }: { online: boolean; token: string }) {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [pods, setPods] = useState<PodRow[]>([]);
  const [clusterLoading, setClusterLoading] = useState(true);

  useEffect(() => {
    setClusterLoading(true);
    fetch(`/api/cluster/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (data.nodes) setNodes(data.nodes);
        if (data.pods) setPods(data.pods);
      })
      .catch(() => {})
      .finally(() => setClusterLoading(false));
  }, [token]);

  const runningPods = pods.filter(p => p.status === 'Running').length;
  const avgCpu = nodes.length > 0
    ? Math.round(nodes.reduce((s, n) => s + (n.cpu ?? 0), 0) / nodes.length)
    : 0;
  const avgMem = nodes.length > 0
    ? Math.round(nodes.reduce((s, n) => s + (n.mem ?? 0), 0) / nodes.length)
    : 0;

  return (
    <div className="cluster-view">
      <div className="cluster-head">
        <div>
          <div className="crumb">k3s-cluster / overview</div>
          <h2>Cluster</h2>
        </div>
        <div style={{ display: 'flex', gap: 24, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          <span><span style={{ color: 'var(--ink-3)' }}>status </span>
            <span style={{ color: online ? 'var(--signal)' : 'var(--danger)' }}>
              {online ? 'healthy' : 'degraded'}
            </span>
          </span>
        </div>
      </div>

      {clusterLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          Loading cluster data…
        </div>
      ) : (
        <>
          <div className="metric-grid">
            {[
              { k: 'Nodes',  v: `${nodes.length}`,     unit: '',           trend: nodes.length > 0 ? '↑ all healthy' : '—', tClass: '' },
              { k: 'Pods',   v: `${runningPods}`,       unit: `/${pods.length}`, trend: runningPods === pods.length ? '↑ running' : '⚠ some down', tClass: runningPods < pods.length ? 'warn' : '' },
              { k: 'CPU',    v: `${avgCpu}`,            unit: '%',          trend: avgCpu > 80 ? '⚠ high' : '⬤ nominal', tClass: avgCpu > 80 ? 'warn' : 'flat' },
              { k: 'Memory', v: `${avgMem}`,            unit: '%',          trend: avgMem > 80 ? '⚠ high' : '⬤ nominal', tClass: avgMem > 80 ? 'warn' : 'flat' },
            ].map(m => (
              <div key={m.k} className="metric">
                <div className="k">{m.k}</div>
                <div className="v">{m.v}<span className="unit">{m.unit}</span></div>
                <div className={`trend ${m.tClass}`}>{m.trend}</div>
              </div>
            ))}
          </div>

          {nodes.length > 0 && (
            <>
              <div className="section-head">
                Nodes
                <div className="actions">
                  <button onClick={() => {
                    fetch(`/api/cluster/status`, { headers: { Authorization: `Bearer ${token}` } })
                      .then(r => r.json()).then(data => { if (data.nodes) setNodes(data.nodes); if (data.pods) setPods(data.pods); }).catch(() => {});
                  }}>Refresh</button>
                </div>
              </div>
              <div className="node-grid">
                {nodes.map(n => (
                  <div key={n.name} className="node-card">
                    <div className="node-head">
                      <span className={`role${n.role === 'worker' ? ' worker' : ''}`}>{n.role}</span>
                      <span className="name">{n.name}</span>
                      <span className="dot" />
                      <span className="ip">{n.ip}</span>
                    </div>
                    <div className="node-body">
                      <div className="node-stat">
                        <div className="k">CPU</div>
                        <div className="v">{n.cpu}%</div>
                        <div className="node-bar signal"><span style={{ width: `${n.cpu}%` }} /></div>
                      </div>
                      <div className="node-stat">
                        <div className="k">Memory</div>
                        <div className="v">{n.mem}%</div>
                        <div className="node-bar"><span style={{ width: `${n.mem}%` }} /></div>
                      </div>
                      <div className="node-stat">
                        <div className="k">Pods</div>
                        <div className="v">{n.pods}</div>
                        <div className="node-bar"><span style={{ width: `${Math.min(100, n.pods * 5)}%` }} /></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {pods.length > 0 && (
            <>
              <div className="section-head">
                Pods
                <div className="actions">
                  <button>All namespaces</button>
                </div>
              </div>
              <div className="pod-table-wrap">
                <table className="pod-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Namespace</th>
                      <th>Model</th>
                      <th>Status</th>
                      <th>Ready</th>
                      <th>Restarts</th>
                      <th>Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pods.map(p => (
                      <tr key={p.name}>
                        <td className="pod-name">{p.name}</td>
                        <td>{p.namespace}</td>
                        <td className="model">{p.model ?? '—'}</td>
                        <td>
                          <span className={`badge${p.status !== 'Running' ? ' warn' : ''}`}>
                            <span className="dot" />
                            {p.status}
                          </span>
                        </td>
                        <td>{p.ready}</td>
                        <td>{p.restarts}</td>
                        <td className="age">{p.age}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {nodes.length === 0 && pods.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              No cluster data available. Check backend connection.
            </div>
          )}

          <div className="section-head">Services</div>
          <div className="service-card">
            <div>
              <div className="svc-k">API</div>
              <div className="svc-v">chat-backend <span className="endpoint">:5000</span></div>
            </div>
            <div>
              <div className="svc-k">Frontend</div>
              <div className="svc-v">chat-frontend <span className="endpoint">:3000</span></div>
            </div>
            <div>
              <div className="svc-k">Ollama NodePort</div>
              <div className="svc-v">ollama-svc <span className="endpoint">:31434</span></div>
            </div>
            <div>
              <div className="svc-k">Ingress</div>
              <div className="svc-v">nginx <span className="endpoint">:80/:443</span></div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
