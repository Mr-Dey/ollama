import React, { useState, useEffect } from 'react';

interface Endpoint {
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH';
  path: string;
  auth: 'none' | 'bearer' | 'admin';
  desc: string;
  body?: string;
  response: string;
  note?: string;
}

const API_GROUPS: { label: string; endpoints: Endpoint[] }[] = [
  {
    label: 'Authentication',
    endpoints: [
      {
        method: 'POST', path: '/api/auth/login', auth: 'none',
        desc: 'Authenticate with username and password. Returns a JWT token valid for 24h.',
        body: JSON.stringify({ username: 'admin', password: 'admin123' }, null, 2),
        response: JSON.stringify({ token: 'eyJhbGci...', user: { id: '...', username: 'admin', role: 'admin', email: 'admin@ollama.local' } }, null, 2),
      },
      {
        method: 'GET', path: '/api/auth/me', auth: 'bearer',
        desc: 'Returns the profile of the currently authenticated user.',
        response: JSON.stringify({ _id: '...', username: 'admin', role: 'admin', email: 'admin@ollama.local' }, null, 2),
      },
    ],
  },
];

const METHOD_COLOR: Record<string, string> = {
  GET: '#6db3f2',
  POST: '#7dd87a',
  DELETE: '#f08570',
  PATCH: '#f0c674',
};
const AUTH_LABEL: Record<string, { text: string; color: string }> = {
  none:   { text: 'No auth',    color: 'var(--ink-4)' },
  bearer: { text: 'Bearer JWT', color: 'var(--bone)' },
  admin:  { text: 'Admin JWT',  color: '#f0c674' },
};

function specToGroups(spec: any): { label: string; endpoints: Endpoint[] }[] {
  if (!spec?.paths) return API_GROUPS;
  const groups: Record<string, Endpoint[]> = {};

  const exampleFromSchema = (schema: any): any => {
    if (!schema) return undefined;
    if (schema.example !== undefined) return schema.example;
    if (schema.type === 'object' && schema.properties) {
      const out: any = {};
      for (const [k, v] of Object.entries<any>(schema.properties)) {
        out[k] = exampleFromSchema(v) ?? (v.type === 'string' ? `<${k}>` : v.type === 'number' ? 0 : v.type === 'boolean' ? false : null);
      }
      return out;
    }
    if (schema.type === 'array') return [exampleFromSchema(schema.items)];
    if (schema.type === 'integer' || schema.type === 'number') return 0;
    if (schema.type === 'boolean') return false;
    return undefined;
  };

  for (const [path, methods] of Object.entries<any>(spec.paths)) {
    for (const [method, op] of Object.entries<any>(methods)) {
      const m = method.toUpperCase();
      if (!['GET', 'POST', 'DELETE', 'PATCH', 'PUT'].includes(m)) continue;
      const tag = op.tags?.[0] || 'Other';

      let bodyStr: string | undefined;
      const reqSchema = op.requestBody?.content?.['application/json']?.schema;
      if (reqSchema) {
        const ex = exampleFromSchema(reqSchema);
        if (ex !== undefined) bodyStr = JSON.stringify(ex, null, 2);
      }

      const respSchema = op.responses?.['200']?.content?.['application/json']?.schema;
      const respEx = respSchema ? exampleFromSchema(respSchema) : op.responses?.['200']?.description;
      const respStr = typeof respEx === 'string' ? respEx : JSON.stringify(respEx ?? { ok: true }, null, 2);

      const auth: Endpoint['auth'] = op.security ? (tag === 'Admin' ? 'admin' : 'bearer') : 'none';

      const endpoint: Endpoint = {
        method: m as Endpoint['method'],
        path: path.replace(/\{(\w+)\}/g, ':$1'),
        auth,
        desc: op.summary || op.description || '',
        body: bodyStr,
        response: respStr,
        note: op.description && op.description !== op.summary ? op.description : undefined,
      };
      (groups[tag] = groups[tag] || []).push(endpoint);
    }
  }
  return Object.entries(groups).map(([label, endpoints]) => ({ label, endpoints }));
}

export default function ApiDocsView({ baseUrl }: { baseUrl: string }) {
  const [openIdx, setOpenIdx] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [groups, setGroups] = useState<{ label: string; endpoints: Endpoint[] }[]>(API_GROUPS);
  const [specLoaded, setSpecLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/docs.json')
      .then(r => r.ok ? r.json() : null)
      .then(spec => { if (spec) { setGroups(specToGroups(spec)); setSpecLoaded(true); } })
      .catch(() => {});
  }, []);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
  };

  const makeCurl = (ep: Endpoint): string => {
    const authHeader = ep.auth !== 'none' ? `\\\n  -H "Authorization: Bearer $TOKEN" ` : '';
    const contentType = ep.body && !ep.body.startsWith('//') ? `\\\n  -H "Content-Type: application/json" ` : '';
    const bodyFlag = ep.body && !ep.body.startsWith('//') ? `\\\n  -d '${ep.body.replace(/\n\s*/g, ' ')}' ` : '';
    return `curl -X ${ep.method} "${baseUrl}${ep.path}" ${authHeader}${contentType}${bodyFlag}`.trim();
  };

  const filtered = search.trim()
    ? groups.map(g => ({
        ...g,
        endpoints: g.endpoints.filter(e =>
          e.path.toLowerCase().includes(search.toLowerCase()) ||
          e.desc.toLowerCase().includes(search.toLowerCase()) ||
          e.method.toLowerCase().includes(search.toLowerCase())
        ),
      })).filter(g => g.endpoints.length > 0)
    : groups;

  return (
    <div className="cluster-view">
      <div className="cluster-head">
        <div>
          <div className="crumb">k3s-cluster / api-reference</div>
          <h2>API Reference</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>Base URL</div>
          <div
            style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--bone)', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}
            onClick={() => copy(baseUrl, 'baseurl')}
            title="Click to copy"
          >
            {baseUrl}
            {copied === 'baseurl' && <span style={{ marginLeft: 8, color: 'var(--signal)', fontSize: 10 }}>copied!</span>}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1180, margin: '0 auto 20px', padding: '14px 18px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--bg-elev)', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.7 }}>
        <span style={{ color: 'var(--bone)', fontWeight: 600 }}>Authentication: </span>
        Get a token via <span style={{ color: 'var(--ink-2)' }}>POST /api/auth/login</span>, then send it as{' '}
        <span style={{ color: 'var(--ink-2)' }}>Authorization: Bearer &lt;token&gt;</span> on protected routes.
        <span style={{ marginLeft: 16, color: '#f0c674' }}>Admin</span> routes additionally require <span style={{ color: 'var(--ink-2)' }}>role: "admin"</span> on the JWT.
        <span style={{ marginLeft: 16, padding: '2px 8px', borderRadius: 4, fontSize: 10, color: specLoaded ? 'var(--signal)' : 'var(--ink-4)', border: `1px solid ${specLoaded ? 'var(--signal-line)' : 'var(--line)'}` }}>
          {specLoaded ? 'LIVE from /api/docs.json' : 'static fallback'}
        </span>
      </div>

      <div style={{ maxWidth: 1180, margin: '0 auto 20px' }}>
        <input
          type="text"
          placeholder="Filter endpoints…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 14px', color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
        />
      </div>

      {filtered.map(group => (
        <div key={group.label} style={{ maxWidth: 1180, margin: '0 auto 28px' }}>
          <div className="section-head" style={{ marginBottom: 10 }}>{group.label}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {group.endpoints.map(ep => {
              const key = `${ep.method}${ep.path}`;
              const isOpen = openIdx === key;
              const curlCmd = makeCurl(ep);
              return (
                <div key={key} style={{ border: '1px solid var(--line)', borderRadius: 10, background: 'var(--bg-elev)', overflow: 'hidden' }}>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setOpenIdx(isOpen ? null : key)}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: METHOD_COLOR[ep.method], minWidth: 52, letterSpacing: '0.04em' }}>{ep.method}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)', flex: 1 }}>{ep.path}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: AUTH_LABEL[ep.auth].color, border: `1px solid ${AUTH_LABEL[ep.auth].color}33`, borderRadius: 4, padding: '2px 7px', opacity: 0.85 }}>{AUTH_LABEL[ep.auth].text}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', maxWidth: 480, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.desc}</span>
                    <span style={{ color: 'var(--ink-3)', fontSize: 12, marginLeft: 8 }}>{isOpen ? '▲' : '▼'}</span>
                  </div>

                  {isOpen && (
                    <div style={{ borderTop: '1px solid var(--line)', padding: '18px 18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>{ep.desc}</p>
                      {ep.note && <p style={{ margin: 0, fontSize: 12, color: 'var(--warn)', fontFamily: 'var(--font-mono)', background: 'var(--warn-soft)', border: '1px solid rgba(240,198,116,0.25)', borderRadius: 6, padding: '8px 12px', lineHeight: 1.6 }}>ℹ {ep.note}</p>}

                      <div style={{ display: 'grid', gridTemplateColumns: ep.body ? '1fr 1fr' : '1fr', gap: 14 }}>
                        {ep.body && (
                          <div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>Request Body</div>
                            <div style={{ position: 'relative' }}>
                              <pre style={{ margin: 0, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-2)', overflow: 'auto', maxHeight: 240, lineHeight: 1.55 }}>{ep.body}</pre>
                              <button onClick={() => copy(ep.body!, key + 'body')} style={{ position: 'absolute', top: 8, right: 8, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 4, padding: '3px 8px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)', cursor: 'pointer' }}>
                                {copied === key + 'body' ? 'copied!' : 'copy'}
                              </button>
                            </div>
                          </div>
                        )}
                        <div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>Response</div>
                          <div style={{ position: 'relative' }}>
                            <pre style={{ margin: 0, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--signal)', overflow: 'auto', maxHeight: 240, lineHeight: 1.55 }}>{ep.response}</pre>
                            <button onClick={() => copy(ep.response, key + 'res')} style={{ position: 'absolute', top: 8, right: 8, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 4, padding: '3px 8px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)', cursor: 'pointer' }}>
                              {copied === key + 'res' ? 'copied!' : 'copy'}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>cURL Example</div>
                        <div style={{ position: 'relative' }}>
                          <pre style={{ margin: 0, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px 12px 14px', fontFamily: 'var(--font-mono)', fontSize: 12, color: '#6db3f2', overflow: 'auto', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{curlCmd}</pre>
                          <button onClick={() => copy(curlCmd, key + 'curl')} style={{ position: 'absolute', top: 8, right: 8, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 4, padding: '3px 8px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)', cursor: 'pointer' }}>
                            {copied === key + 'curl' ? 'copied!' : 'copy'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
