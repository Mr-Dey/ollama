import React from 'react';

const SUGGESTS = [
  { label: 'Cluster',   body: 'Show me the current pod status and resource usage' },
  { label: 'Deploy',    body: 'Generate a k3s Deployment manifest for 3 replicas' },
  { label: 'Debug',     body: 'Why is my pod stuck in CrashLoopBackOff?' },
  { label: 'Streaming', body: 'Refactor server.js to stream tokens with SSE' },
];

export default function EmptyState({ onSuggest }: { onSuggest: (text: string) => void }) {
  return (
    <div className="empty">
      <div className="glyph">Λ</div>
      <h1>What can I help with?</h1>
      <p>Ask about your k3s cluster, deployment manifests, or attach logs and files for analysis.</p>
      <div className="suggest-grid">
        {SUGGESTS.map(s => (
          <button key={s.label} className="suggest" onClick={() => onSuggest(s.body)}>
            <div className="label">{s.label}</div>
            <div className="body">{s.body}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
