import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from 'react';
import './App.css';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Attachment {
  kind: 'file' | 'image';
  name: string;
  ext?: string;
  size?: string;
  dataUrl?: string;
  file?: File;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  latency?: string;
  pod?: string;
  attachments?: Attachment[];
}

interface Thread {
  id: string;
  title: string;
  model: string;
  time: string;
  group: string;
  messages: ChatMessage[];
}

interface Settings {
  model: string;
  temp: number;
  topP: number;
  maxTokens: number;
  stream: boolean;
  voice: boolean;
  system: string;
}

interface NodeInfo {
  role: string;
  name: string;
  ip: string;
  cpu: number;
  mem: number;
  pods: number;
}

interface PodRow {
  name: string;
  namespace: string;
  model?: string;
  status: 'Running' | 'Pending' | 'Failed';
  ready: string;
  restarts: number;
  age: string;
}

type View = 'chat' | 'cluster' | 'models';

// ─── Seed Data ────────────────────────────────────────────────────────────────

const SEED_THREADS: Thread[] = [
  { id: 't1', title: 'Refactor server.js to stream SSE',        model: 'llama3.1:8b', time: '14:02',     group: 'Today',     messages: [] },
  { id: 't2', title: 'Diagnose mt4lz pod CrashLoopBackoff',     model: 'llama3.1:8b', time: '11:48',     group: 'Today',     messages: [] },
  { id: 't3', title: 'Describe the architecture diagram',       model: 'llava:13b',   time: '09:15',     group: 'Today',     messages: [] },
  { id: 't4', title: 'Summarize plan.md deployment phases',     model: 'llama3.1:8b', time: 'Yesterday', group: 'Yesterday', messages: [] },
  { id: 't5', title: 'Generate k3s manifest, 3 replicas',       model: 'mistral:7b',  time: 'Yesterday', group: 'Yesterday', messages: [] },
  { id: 't6', title: 'Nginx port-3000 reverse proxy config',    model: 'llama3.1:8b', time: 'Mon',       group: 'This week', messages: [] },
  { id: 't7', title: 'Why does multer reject the PDF over 5MB', model: 'llama3.1:8b', time: 'Mon',       group: 'This week', messages: [] },
  { id: 't8', title: 'Compare phi3:mini vs mistral:7b latency', model: 'llama3.1:8b', time: 'Sun',       group: 'This week', messages: [] },
];

const SEED_MESSAGES: Record<string, ChatMessage[]> = {
  t1: [
    {
      id: 'm1',
      role: 'user',
      content: 'Refactor server.js to stream tokens over SSE. The current implementation buffers the whole response from the ollama-service endpoint — clients are waiting 4-6s for the first token. Use the streaming flag in the Ollama API.',
      attachments: [{ kind: 'file', name: 'server.js', ext: 'JS', size: '8.2 KB' }],
    },
    {
      id: 'm2',
      role: 'assistant',
      model: 'llama3.1:8b',
      latency: 'first token in 184ms',
      pod: 'pod/x2p7q',
      content: "Here's the rewrite. The key change is opening an `EventSource`-compatible stream by writing `text/event-stream` headers and forwarding each chunk from the Ollama upstream as it arrives:\n\n```js\napp.post('/api/chat', async (req, res) => {\n  res.setHeader('Content-Type', 'text/event-stream');\n  res.setHeader('Cache-Control', 'no-cache');\n  res.flushHeaders();\n\n  const upstream = await axios.post(\n    `${OLLAMA_HOST}/api/chat`,\n    { ...req.body, stream: true },\n    { responseType: 'stream' }\n  );\n\n  upstream.data.on('data', (chunk) => {\n    res.write(`data: ${chunk}\\n\\n`);\n  });\n  upstream.data.on('end', () => res.end());\n});\n```\n\nA few notes specific to your setup:\n\n• The `pdf-parse` and `multer` paths can stay unchanged — they only fire on the upload route, not on chat.\n• On the React side, swap your `axios.post` for `new EventSource('/api/chat')` and accumulate `event.data` into state. The `App.tsx` cursor animation will then feel near-instant.\n• Because you're exposing this through NodePort `31434`, set `X-Accel-Buffering: no` upstream so Nginx (port 3000) doesn't buffer the stream.",
    },
  ],
  t2: [
    {
      id: 'm1',
      role: 'user',
      content: 'the mt4lz pod restarted 3 times in the last hour. logs say `OOMKilled`. it\'s the one running llava:13b on vm2.',
    },
    {
      id: 'm2',
      role: 'assistant',
      model: 'llama3.1:8b',
      latency: '242ms',
      pod: 'pod/x2p7q',
      content: '`llava:13b` needs ~12 GiB resident at full context — your `resources.limits.memory: 12Gi` is right at the ceiling. Two fixes:\n\n1. **Raise the limit to 14Gi** in `ollama.yaml`. vm2-worker has 16 GiB and currently sits at 13.0 GiB used, so there\'s headroom.\n2. **Or split llava off** onto a dedicated pod with a `nodeAffinity` rule. That keeps text-only requests responsive when vision traffic spikes.\n\nI\'d go with (1) first — it\'s a one-line patch and no rescheduling needed.',
    },
  ],
};

const CANNED_RESPONSES: Record<string, string> = {
  'plan.md':  'Looking at `plan.md`, the deployment is split into four phases:\n\n1. **Infrastructure** — k3s on two VMs (master 172.16.9.203, worker 172.16.9.253), `virsh` revert scripts for clean state.\n2. **Model pull** — `deploy_ai_cluster.sh` is idempotent and pulls `llama3.1:8b`, `llava:13b`, `mistral:7b` into the shared volume.\n3. **API layer** — Express proxy at `:5000` handles PDF parsing, multer uploads, and auto-routes image inputs to `llava:13b`.\n4. **Frontend** — React production build served by Nginx on `:3000` with dynamic host detection.',
  image:      'I can see what looks like your cluster dashboard. The grid shows two nodes — a master and a worker — both reporting healthy. CPU utilization on the worker is noticeably higher than the master, which is consistent with `llava:13b` being scheduled there.',
  manifest:   'Here\'s a Deployment manifest with 3 replicas:\n\n```yaml\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ollama\nspec:\n  replicas: 3\n  selector: { matchLabels: { app: ollama } }\n  template:\n    metadata: { labels: { app: ollama } }\n    spec:\n      containers:\n      - name: ollama\n        image: ollama/ollama:latest\n        ports: [{ containerPort: 11434 }]\n        resources:\n          limits: { cpu: "4", memory: "14Gi" }\n```',
  default:    'Connected to the cluster. The request hit `pod/x2p7q` on vm1-master, served by `llama3.1:8b`. First token landed in **184ms** — that\'s the SSE stream you set up.\n\nAsk me about the cluster state, the deployment manifests, or hand me a file and I\'ll work through it.',
};

const NODES: NodeInfo[] = [
  { role: 'master', name: 'vm1-master', ip: '172.16.9.203', cpu: 38, mem: 52, pods: 9  },
  { role: 'worker', name: 'vm2-worker', ip: '172.16.9.253', cpu: 74, mem: 81, pods: 14 },
];

const POD_ROWS: PodRow[] = [
  { name: 'ollama-text-7f9c4',   namespace: 'ai',           model: 'llama3.1:8b', status: 'Running', ready: '1/1', restarts: 0, age: '3d' },
  { name: 'ollama-vision-a3b2',  namespace: 'ai',           model: 'llava:13b',   status: 'Running', ready: '1/1', restarts: 1, age: '3d' },
  { name: 'chat-backend-x2p7q',  namespace: 'ai',           model: undefined,     status: 'Running', ready: '1/1', restarts: 0, age: '2d' },
  { name: 'chat-frontend-n8k1q', namespace: 'ai',           model: undefined,     status: 'Running', ready: '1/1', restarts: 0, age: '2d' },
  { name: 'nginx-ingress-6b7d',  namespace: 'ingress-nginx',model: undefined,     status: 'Running', ready: '1/1', restarts: 0, age: '7d' },
  { name: 'coredns-787d4945fb',  namespace: 'kube-system',  model: undefined,     status: 'Running', ready: '1/1', restarts: 0, age: '7d' },
  { name: 'metrics-server-648b', namespace: 'kube-system',  model: undefined,     status: 'Pending', ready: '0/1', restarts: 3, age: '1d' },
];

const MODELS_LIST = [
  { name: 'llama3.1:8b',  size: '4.7 GB', type: 'text',   quant: 'Q4_K_M', ctx: '128k', pulled: true  },
  { name: 'llava:13b',    size: '8.0 GB', type: 'vision', quant: 'Q4_K_M', ctx: '4k',   pulled: true  },
  { name: 'mistral:7b',   size: '4.1 GB', type: 'text',   quant: 'Q4_0',   ctx: '8k',   pulled: true  },
  { name: 'phi3:mini',    size: '2.3 GB', type: 'text',   quant: 'Q4_K_M', ctx: '128k', pulled: false },
  { name: 'gemma:7b',     size: '5.0 GB', type: 'text',   quant: 'Q4_0',   ctx: '8k',   pulled: false },
  { name: 'gemma4:2b',    size: '1.8 GB', type: 'text',   quant: 'Q4_K_M', ctx: '8k',   pulled: false },
  { name: 'gemma4:4b',    size: '3.3 GB', type: 'text',   quant: 'Q4_K_M', ctx: '8k',   pulled: false },
  { name: 'qwen3.5:2b',   size: '1.7 GB', type: 'text',   quant: 'Q4_K_M', ctx: '32k',  pulled: false },
  { name: 'qwen3.5:4b',   size: '2.6 GB', type: 'text',   quant: 'Q4_K_M', ctx: '32k',  pulled: false },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function pickResponse(content: string, attachments?: Attachment[]): string {
  if (attachments?.some(a => a.kind === 'image')) return CANNED_RESPONSES.image;
  const lower = content.toLowerCase();
  if (lower.includes('plan.md'))                                    return CANNED_RESPONSES['plan.md'];
  if (lower.includes('manifest') || lower.includes('replica'))     return CANNED_RESPONSES.manifest;
  return CANNED_RESPONSES.default;
}

// Render message content: handle code fences and bold
function renderContent(text: string): React.ReactNode[] {
  const blocks = text.split(/(```[\s\S]*?```)/g);
  return blocks.map((block, bi) => {
    if (block.startsWith('```')) {
      const inner = block.slice(3);
      const nlIdx = inner.indexOf('\n');
      const lang  = nlIdx > -1 ? inner.slice(0, nlIdx).trim() : '';
      const code  = nlIdx > -1 ? inner.slice(nlIdx + 1).replace(/```$/, '') : inner.replace(/```$/, '');
      return (
        <pre key={bi}>
          {lang && <div className="pre-head"><span>{lang}</span></div>}
          <code>{code}</code>
        </pre>
      );
    }
    // inline bold **...**
    const parts = block.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={bi}>
        {parts.map((p, pi) =>
          p.startsWith('**') && p.endsWith('**')
            ? <strong key={pi}>{p.slice(2, -2)}</strong>
            : <span key={pi}>{p}</span>
        )}
      </span>
    );
  });
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const IcoPlus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);
const IcoPanelLeft = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <line x1="9" y1="3" x2="9" y2="21"/>
  </svg>
);
const IcoSettings = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06
             a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09
             A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83
             l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09
             A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83
             l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09
             a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83
             l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09
             a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);
const IcoMoon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);
const IcoSun = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);
const IcoMic = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
);
const IcoPaperclip = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66
             l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
  </svg>
);
const IcoSend = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
);
const IcoCopy = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);
const IcoVolume = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
  </svg>
);
const IcoRefresh = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
);
const IcoX = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const IcoPhone = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="5" y="2" width="14" height="20" rx="2"/>
    <line x1="12" y1="18" x2="12.01" y2="18"/>
  </svg>
);

// ─── TopBar ───────────────────────────────────────────────────────────────────

interface TopBarProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  view: View;
  onViewChange: (v: View) => void;
  clusterOnline: boolean;
  podCount: number;
  podTotal: number;
  settings: Settings;
  onSettingsOpen: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onMobileOverlay: () => void;
  activeThread: Thread | undefined;
}

function TopBar({
  sidebarCollapsed,
  onToggleSidebar,
  view,
  onViewChange,
  clusterOnline,
  podCount,
  podTotal,
  settings,
  onSettingsOpen,
  theme,
  onToggleTheme,
  onMobileOverlay,
  activeThread,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <div className="brand-mark">Λ</div>
        <div className="brand-name">
          ollama<span>k3s-cluster</span>
        </div>
        <button className="sidebar-toggle icon-btn" onClick={onToggleSidebar} title="Toggle sidebar">
          <IcoPanelLeft />
        </button>
      </div>

      <div className="topbar-mid">
        {/* View tabs */}
        <button
          className={`nav-item${view === 'chat' ? ' active' : ''}`}
          onClick={() => onViewChange('chat')}
          style={{ width: 'auto' }}
        >
          Chat
        </button>
        <button
          className={`nav-item${view === 'cluster' ? ' active' : ''}`}
          onClick={() => onViewChange('cluster')}
          style={{ width: 'auto' }}
        >
          Cluster
        </button>
        <button
          className={`nav-item${view === 'models' ? ' active' : ''}`}
          onClick={() => onViewChange('models')}
          style={{ width: 'auto' }}
        >
          Models
        </button>

        {view === 'chat' && activeThread && (
          <>
            <span className="sep" style={{ color: 'var(--ink-4)', fontSize: 12 }}>/</span>
            <span style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeThread.title}
            </span>
          </>
        )}
      </div>

      <div className="topbar-end">
        {clusterOnline ? (
          <div className="status-pill">
            <span className="dot" />
            <span>online</span>
            <span className="sep">·</span>
            <span className="num">{podCount}/{podTotal}</span>
            <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>pods</span>
          </div>
        ) : (
          <div className="status-pill" style={{ borderColor: 'var(--line)', background: 'transparent' }}>
            <span className="dot" style={{ background: 'var(--ink-4)', animation: 'none' }} />
            <span style={{ color: 'var(--ink-3)' }}>offline</span>
          </div>
        )}

        <button
          className="model-pill"
          style={{ cursor: 'pointer', border: '1px solid var(--line)', background: 'var(--bg-elev)', fontFamily: 'var(--font-mono)', fontSize: 13 }}
          onClick={onSettingsOpen}
          title="Change model"
        >
          {settings.model}
          <span className="tag">model</span>
        </button>

        <button className="icon-btn" onClick={onMobileOverlay} title="Mobile preview">
          <IcoPhone />
        </button>
        <button className="icon-btn" onClick={onToggleTheme} title="Toggle theme">
          {theme === 'dark' ? <IcoSun /> : <IcoMoon />}
        </button>
        <button className="icon-btn" onClick={onSettingsOpen} title="Settings">
          <IcoSettings />
        </button>
      </div>
    </header>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

interface SidebarProps {
  collapsed: boolean;
  threads: Thread[];
  activeId: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  view: View;
  onViewChange: (v: View) => void;
}

function Sidebar({ collapsed, threads, activeId, onSelect, onNewChat, view, onViewChange }: SidebarProps) {
  const groups = useMemo(() => {
    const map: Record<string, Thread[]> = {};
    const order: string[] = [];
    for (const t of threads) {
      if (!map[t.group]) { map[t.group] = []; order.push(t.group); }
      map[t.group].push(t);
    }
    return order.map(g => ({ label: g, items: map[g] }));
  }, [threads]);

  return (
    <aside className="sidebar">
      <div className="side-section">
        <button className="new-chat-btn" onClick={onNewChat}>
          <IcoPlus />
          New chat
          <span className="kbd">⌘K</span>
        </button>
      </div>

      <div className="side-section">
        <div className="nav-list">
          {(['chat', 'cluster', 'models'] as View[]).map(v => (
            <button
              key={v}
              className={`nav-item${view === v ? ' active' : ''}`}
              onClick={() => onViewChange(v)}
            >
              {v === 'chat'    && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
              {v === 'cluster' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>}
              {v === 'models'  && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>}
              <span style={{ textTransform: 'capitalize' }}>{v}</span>
              <span className="nav-tag">{v === 'chat' ? `${threads.length}` : ''}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="history">
        {groups.map(({ label, items }) => (
          <div key={label} className="history-group">
            <div className="side-label">
              {label}
              <span className="count">{items.length}</span>
            </div>
            {items.map(t => (
              <div
                key={t.id}
                className={`history-item${t.id === activeId ? ' active' : ''}`}
                onClick={() => onSelect(t.id)}
              >
                <div className="title">{t.title}</div>
                <div className="meta">
                  <span className="model-tag">{t.model}</span>
                  <span>·</span>
                  <span>{t.time}</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="side-foot">
        <div className="avatar">U</div>
        <div>
          <div className="who">k3s-admin</div>
          <div className="role">cluster operator</div>
        </div>
      </div>
    </aside>
  );
}

// ─── MessageRender ────────────────────────────────────────────────────────────

function MessageRender({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div className="msg-bubble">
      {renderContent(content)}
      {streaming && <span className="cursor" />}
    </div>
  );
}

// ─── Message ──────────────────────────────────────────────────────────────────

interface MsgProps {
  msg: ChatMessage;
  onCopy: (text: string) => void;
  onSpeak: (text: string) => void;
  streaming?: boolean;
  hasImageAttach?: boolean;
}

function Message({ msg, onCopy, onSpeak, streaming, hasImageAttach }: MsgProps) {
  const isUser = msg.role === 'user';
  return (
    <div className={`msg ${msg.role}`}>
      <div className="msg-avatar">{isUser ? 'U' : 'Λ'}</div>
      <div className="msg-body">
        {msg.role === 'assistant' && (
          <div className="msg-head">
            {msg.model && <span className="model">{msg.model}</span>}
            {msg.latency && <span className="latency">{msg.latency}</span>}
            {msg.pod && <span className="pod">{msg.pod}</span>}
          </div>
        )}

        {/* Attachments */}
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="attach-chips">
            {msg.attachments.filter(a => a.kind === 'file').map((a, i) => (
              <div key={i} className="attach-chip">
                <div className="file-icon">{a.ext || 'FILE'}</div>
                <span className="name">{a.name}</span>
                {a.size && <span className="size">{a.size}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Image attachments */}
        {msg.attachments?.filter(a => a.kind === 'image').map((a, i) => (
          <div key={i} className="attach-image">
            {a.dataUrl
              ? <img src={a.dataUrl} alt="upload" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div className="placeholder">IMAGE</div>
            }
            <span className="multi-modal-tag">llava:13b routed</span>
          </div>
        ))}

        {/* Multi-modal banner */}
        {hasImageAttach && msg.role === 'assistant' && (
          <div className="modal-route-banner">
            <span>routed</span>
            <span className="arrow">→</span>
            <span className="tag">llava:13b</span>
            <span style={{ color: 'var(--ink-4)' }}>·</span>
            <span style={{ color: 'var(--ink-3)' }}>vision model</span>
          </div>
        )}

        <MessageRender content={msg.content} streaming={streaming} />

        <div className="msg-actions">
          <button className="msg-action-btn" onClick={() => onCopy(msg.content)} title="Copy">
            <IcoCopy />
          </button>
          {msg.role === 'assistant' && (
            <>
              <button className="msg-action-btn" onClick={() => onSpeak(msg.content)} title="Speak">
                <IcoVolume />
              </button>
              <button className="msg-action-btn" title="Regenerate">
                <IcoRefresh />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  onSuggest: (text: string) => void;
}

const SUGGESTS = [
  { label: 'Cluster',   body: 'Show me the current pod status and resource usage' },
  { label: 'Deploy',    body: 'Generate a k3s Deployment manifest for 3 replicas' },
  { label: 'Debug',     body: 'Why is my pod stuck in CrashLoopBackOff?' },
  { label: 'Streaming', body: 'Refactor server.js to stream tokens with SSE' },
];

function EmptyState({ onSuggest }: EmptyStateProps) {
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

// ─── Composer ─────────────────────────────────────────────────────────────────

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  loading: boolean;
  isListening: boolean;
  onToggleMic: () => void;
  attachments: Attachment[];
  onAttach: (files: FileList) => void;
  onRemoveAttach: (i: number) => void;
  model: string;
}

function Composer({
  value, onChange, onSend, loading, isListening, onToggleMic,
  attachments, onAttach, onRemoveAttach, model,
}: ComposerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const hasImages = attachments.some(a => a.kind === 'image');

  useEffect(() => {
    if (textRef.current) {
      textRef.current.style.height = 'auto';
      textRef.current.style.height = `${Math.min(textRef.current.scrollHeight, 180)}px`;
    }
  }, [value]);

  const canSend = (value.trim() !== '' || attachments.length > 0) && !loading;

  return (
    <div className="composer-wrap">
      {hasImages && (
        <div className="modal-route-banner" style={{ marginBottom: 8 }}>
          <span>will route to</span>
          <span className="arrow">→</span>
          <span className="tag">llava:13b</span>
          <span style={{ color: 'var(--ink-4)' }}>·</span>
          <span style={{ color: 'var(--ink-3)' }}>vision model</span>
        </div>
      )}

      <div className="composer">
        {attachments.length > 0 && (
          <div className="composer-attach-row">
            {attachments.map((a, i) => (
              <div key={i} className="attach-chip">
                {a.kind === 'image' && a.dataUrl
                  ? <img src={a.dataUrl} alt="att" style={{ width: 18, height: 18, borderRadius: 3, objectFit: 'cover' }} />
                  : <div className="file-icon">{a.ext || 'FILE'}</div>
                }
                <span className="name">{a.name}</span>
                {a.size && <span className="size">{a.size}</span>}
                <span className="x" onClick={() => onRemoveAttach(i)}><IcoX /></span>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textRef}
          className="composer-input"
          rows={1}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) onSend(); }
          }}
          placeholder="Message ollama…"
          disabled={loading}
        />

        <div className="composer-toolbar">
          <button
            className="tool-btn icon-only"
            onClick={() => fileRef.current?.click()}
            title="Attach file or image"
          >
            <IcoPaperclip />
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept="image/*,.pdf,.txt,.md,.js,.ts,.json,.yaml,.yml"
            onChange={e => { if (e.target.files) onAttach(e.target.files); e.target.value = ''; }}
          />

          <button
            className={`tool-btn icon-only${isListening ? ' mic-rec' : ''}`}
            onClick={onToggleMic}
            title={isListening ? 'Stop recording' : 'Voice input'}
          >
            {isListening
              ? <span className="waveform">
                  <span /><span /><span /><span /><span />
                </span>
              : <IcoMic />
            }
          </button>

          <div className="spacer" />

          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)' }}>
            {model}
          </span>

          <button className="send-btn" onClick={onSend} disabled={!canSend} title="Send (Enter)">
            <IcoSend />
          </button>
        </div>
      </div>

      <div className="composer-hint">
        <div className="kbd-row">
          <span><b>Enter</b> send</span>
          <span><b>Shift+Enter</b> newline</span>
        </div>
        <span>running on k3s cluster</span>
      </div>
    </div>
  );
}

// ─── ClusterView ──────────────────────────────────────────────────────────────

function ClusterView({ online }: { online: boolean }) {
  const runningPods = POD_ROWS.filter(p => p.status === 'Running').length;
  return (
    <div className="cluster-view">
      <div className="cluster-head">
        <div>
          <div className="crumb">k3s-cluster / overview</div>
          <h2>Cluster</h2>
        </div>
        <div style={{ display: 'flex', gap: 24, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          <span><span style={{ color: 'var(--ink-3)' }}>version </span><span>v1.28.4+k3s1</span></span>
          <span><span style={{ color: 'var(--ink-3)' }}>master </span><span>172.16.9.203</span></span>
          <span><span style={{ color: 'var(--ink-3)' }}>status </span>
            <span style={{ color: online ? 'var(--signal)' : 'var(--danger)' }}>
              {online ? 'healthy' : 'degraded'}
            </span>
          </span>
        </div>
      </div>

      {/* Metrics */}
      <div className="metric-grid">
        {[
          { k: 'Nodes',    v: '2',                 unit: '',      trend: '↑ all healthy', tClass: '' },
          { k: 'Pods',     v: `${runningPods}`,    unit: `/${POD_ROWS.length}`, trend: '↑ running',  tClass: '' },
          { k: 'CPU',      v: '56',                unit: '%',     trend: '⬤ nominal',     tClass: 'flat' },
          { k: 'Memory',   v: '67',                unit: '%',     trend: '⚠ high',        tClass: 'warn' },
        ].map(m => (
          <div key={m.k} className="metric">
            <div className="k">{m.k}</div>
            <div className="v">{m.v}<span className="unit">{m.unit}</span></div>
            <div className={`trend ${m.tClass}`}>{m.trend}</div>
          </div>
        ))}
      </div>

      {/* Nodes */}
      <div className="section-head">
        Nodes
        <div className="actions">
          <button>Refresh</button>
          <button>Describe</button>
        </div>
      </div>
      <div className="node-grid">
        {NODES.map(n => (
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

      {/* Pods table */}
      <div className="section-head">
        Pods
        <div className="actions">
          <button>All namespaces</button>
          <button>Refresh</button>
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
            {POD_ROWS.map(p => (
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

      {/* Service card */}
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
    </div>
  );
}

// ─── ModelsView ───────────────────────────────────────────────────────────────

function ModelsView({ activeModel, onSelect }: { activeModel: string; onSelect: (m: string) => void }) {
  return (
    <div className="cluster-view">
      <div className="cluster-head">
        <div>
          <div className="crumb">k3s-cluster / models</div>
          <h2>Models</h2>
        </div>
      </div>
      <div className="section-head">Available models</div>
      <div className="pod-table-wrap">
        <table className="pod-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Quant</th>
              <th>Context</th>
              <th>Size</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {MODELS_LIST.map(m => (
              <tr key={m.name} onClick={() => m.pulled && onSelect(m.name)} style={{ cursor: m.pulled ? 'pointer' : 'default' }}>
                <td className={`pod-name${m.name === activeModel ? ' model' : ''}`}>{m.name}</td>
                <td>{m.type}</td>
                <td><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>{m.quant}</span></td>
                <td>{m.ctx}</td>
                <td>{m.size}</td>
                <td>
                  <span className={`badge${!m.pulled ? ' warn' : ''}`}>
                    <span className="dot" />
                    {m.pulled ? (m.name === activeModel ? 'active' : 'ready') : 'not pulled'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── SettingsDrawer ───────────────────────────────────────────────────────────

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (s: Settings) => void;
  density: string;
  onDensityChange: (d: string) => void;
  theme: string;
  onThemeChange: (t: 'dark' | 'light') => void;
}

function SettingsDrawer({
  open, onClose, settings, onChange, density, onDensityChange, theme, onThemeChange,
}: SettingsDrawerProps) {
  return (
    <div className={`settings-drawer${open ? ' open' : ''}`}>
      <div className="drawer-head">
        <h3>Settings</h3>
        <button className="icon-btn" onClick={onClose}><IcoX /></button>
      </div>
      <div className="drawer-body">

        <div className="field">
          <div className="label">Model</div>
          <select
            style={{ width: '100%', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: 13 }}
            value={settings.model}
            onChange={e => onChange({ ...settings, model: e.target.value })}
          >
            <optgroup label="Llama">
              <option value="llama3.1:8b">llama3.1:8b</option>
              <option value="llama3.1:70b">llama3.1:70b</option>
            </optgroup>
            <optgroup label="Gemma">
              <option value="gemma:7b">gemma:7b</option>
              <option value="gemma4:2b">gemma4:2b</option>
              <option value="gemma4:4b">gemma4:4b</option>
            </optgroup>
            <optgroup label="Qwen">
              <option value="qwen3.5:2b">qwen3.5:2b</option>
              <option value="qwen3.5:4b">qwen3.5:4b</option>
            </optgroup>
            <optgroup label="Other">
              <option value="mistral:7b">mistral:7b</option>
              <option value="phi3:mini">phi3:mini</option>
            </optgroup>
            <optgroup label="Vision">
              <option value="llava:13b">llava:13b</option>
              <option value="llava:7b">llava:7b</option>
            </optgroup>
          </select>
        </div>

        <div className="field">
          <div className="label">
            Temperature
            <span className="val">{settings.temp.toFixed(2)}</span>
          </div>
          <input
            type="range" className="range"
            min={0} max={2} step={0.05}
            value={settings.temp}
            onChange={e => onChange({ ...settings, temp: parseFloat(e.target.value) })}
          />
          <div className="desc">Higher values produce more creative, less deterministic output.</div>
        </div>

        <div className="field">
          <div className="label">
            Top-P
            <span className="val">{settings.topP.toFixed(2)}</span>
          </div>
          <input
            type="range" className="range"
            min={0} max={1} step={0.05}
            value={settings.topP}
            onChange={e => onChange({ ...settings, topP: parseFloat(e.target.value) })}
          />
        </div>

        <div className="field">
          <div className="label">
            Max tokens
            <span className="val">{settings.maxTokens}</span>
          </div>
          <input
            type="range" className="range"
            min={256} max={8192} step={256}
            value={settings.maxTokens}
            onChange={e => onChange({ ...settings, maxTokens: parseInt(e.target.value) })}
          />
        </div>

        <div className="field">
          <div className="label">Streaming</div>
          <div className="seg">
            <button className={settings.stream ? 'on' : ''} onClick={() => onChange({ ...settings, stream: true })}>On</button>
            <button className={!settings.stream ? 'on' : ''} onClick={() => onChange({ ...settings, stream: false })}>Off</button>
          </div>
        </div>

        <div className="field">
          <div className="label">TTS Voice</div>
          <div className="seg">
            <button className={settings.voice ? 'on' : ''} onClick={() => onChange({ ...settings, voice: true })}>On</button>
            <button className={!settings.voice ? 'on' : ''} onClick={() => onChange({ ...settings, voice: false })}>Off</button>
          </div>
        </div>

        <div className="field">
          <div className="label">Density</div>
          <div className="seg">
            {['compact', 'regular', 'comfy'].map(d => (
              <button key={d} className={density === d ? 'on' : ''} onClick={() => onDensityChange(d)}>
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <div className="label">Theme</div>
          <div className="seg">
            <button className={theme === 'dark' ? 'on' : ''} onClick={() => onThemeChange('dark')}>Dark</button>
            <button className={theme === 'light' ? 'on' : ''} onClick={() => onThemeChange('light')}>Light</button>
          </div>
        </div>

        <div className="field">
          <div className="label">System prompt</div>
          <textarea
            className="text-area"
            value={settings.system}
            onChange={e => onChange({ ...settings, system: e.target.value })}
            rows={4}
          />
        </div>

      </div>
    </div>
  );
}

// ─── MobileOverlay ────────────────────────────────────────────────────────────

interface MobileOverlayProps {
  onClose: () => void;
  messages: ChatMessage[];
  streaming: string;
  model: string;
  online: boolean;
}

function MobileOverlay({ onClose, messages, streaming, model, online }: MobileOverlayProps) {
  const last4 = messages.slice(-4);
  return (
    <div className="mobile-overlay" onClick={onClose}>
      <div className="device-wrap" onClick={e => e.stopPropagation()}>
        {/* Phone frame */}
        <div style={{
          width: 320, height: 580, borderRadius: 36,
          background: 'var(--bg-elev)', border: '3px solid var(--line-strong)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.5)', overflow: 'hidden', display: 'flex', flexDirection: 'column',
          position: 'relative',
        }}>
          {/* Notch */}
          <div style={{ height: 32, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 80, height: 10, borderRadius: 5, background: 'var(--line-strong)' }} />
          </div>

          <div className="m-app">
            <div className="m-top">
              <div className="brand-mark" style={{ width: 22, height: 22, borderRadius: 5, fontSize: 11, background: 'var(--bone)', color: 'var(--bone-ink)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>Λ</div>
              <span className="model-mini">{model}</span>
              <div className="pill" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', border: '1px solid var(--signal-line)', background: 'var(--signal-soft)', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--signal)' }}>
                <span className="dot" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--signal)' }} />
                {online ? 'live' : 'offline'}
              </div>
            </div>

            <div className="m-thread">
              {last4.map(m => (
                <div key={m.id} className={`m-msg ${m.role}`}>
                  {m.role === 'assistant' && (
                    <div className="m-msg-head">{m.model ?? model}</div>
                  )}
                  <div className="m-msg-bubble">{m.content.slice(0, 200)}{m.content.length > 200 ? '…' : ''}</div>
                </div>
              ))}
              {streaming && (
                <div className="m-msg assistant">
                  <div className="m-msg-head">{model}</div>
                  <div className="m-msg-bubble">{streaming}<span className="cursor" /></div>
                </div>
              )}
            </div>

            <div className="m-composer">
              <div className="input" style={{ flex: 1, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 22, padding: '9px 14px', fontSize: 13, color: 'var(--ink-4)' }}>
                Message…
              </div>
              <div className="send" style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bone)', color: 'var(--bone-ink)', display: 'grid', placeItems: 'center' }}>
                <IcoSend />
              </div>
            </div>
          </div>
        </div>

        <div className="device-info">
          <h4>Mobile preview</h4>
          <p>This is how the chat looks on a phone-sized viewport. The full app is desktop-first.</p>
          <button className="close" onClick={onClose}>Close preview</button>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const hostname = window.location.hostname;

  // Threads — seed + runtime
  const [threads, setThreads] = useState<Thread[]>(() =>
    SEED_THREADS.map(t => ({ ...t, messages: SEED_MESSAGES[t.id] ?? [] }))
  );
  const [activeId, setActiveId] = useState<string>('t1');

  // Navigation
  const [view, setView]                     = useState<View>('chat');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen]     = useState(false);
  const [mobileOverlay, setMobileOverlay]   = useState(false);

  // Settings
  const [settings, setSettings] = useState<Settings>({
    model: 'llama3.1:8b',
    temp: 0.7,
    topP: 0.9,
    maxTokens: 2048,
    stream: true,
    voice: false,
    system: 'You are a helpful AI assistant running on a self-hosted k3s cluster with Ollama.',
  });
  const [density, setDensity]   = useState('regular');
  const [theme, setTheme]       = useState<'dark' | 'light'>('dark');

  // Chat state
  const [input, setInput]             = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading]         = useState(false);
  const [streamText, setStreamText]   = useState('');

  // Cluster health
  const [clusterOnline, setClusterOnline] = useState(false);

  // STT
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Apply theme + density to documentElement
  useEffect(() => {
    document.documentElement.dataset.theme   = theme;
    document.documentElement.dataset.density = density;
  }, [theme, density]);

  // Health poll every 5s
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`http://${hostname}:5000/health`);
        setClusterOnline(r.ok);
      } catch {
        setClusterOnline(false);
      }
    };
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, [hostname]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threads, streamText]);

  const activeThread = useMemo(() => threads.find(t => t.id === activeId), [threads, activeId]);

  // ── Thread management ──

  const handleNewChat = useCallback(() => {
    const id = genId();
    const t: Thread = {
      id,
      title: 'New chat',
      model: settings.model,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      group: 'Today',
      messages: [],
    };
    setThreads(prev => [t, ...prev]);
    setActiveId(id);
    setView('chat');
  }, [settings.model]);

  const handleSelectThread = useCallback((id: string) => {
    setActiveId(id);
    setView('chat');
  }, []);

  const addMessage = useCallback((threadId: string, msg: ChatMessage) => {
    setThreads(prev => prev.map(t =>
      t.id === threadId ? { ...t, messages: [...t.messages, msg] } : t
    ));
  }, []);

  // ── Simulate word-by-word streaming ──

  const simulateStream = useCallback((text: string): Promise<void> => {
    return new Promise(resolve => {
      const words = text.split(' ');
      let i = 0;
      setStreamText('');
      const tick = () => {
        if (i >= words.length) {
          setStreamText('');
          resolve();
          return;
        }
        setStreamText(words.slice(0, i + 1).join(' '));
        i++;
        const delay = 16 + Math.random() * 14; // 16-30ms
        setTimeout(tick, delay);
      };
      tick();
    });
  }, []);

  // ── Send message ──

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (!activeThread) return;

    const userMsg: ChatMessage = {
      id: genId(),
      role: 'user',
      content: text,
      attachments: attachments.length > 0 ? [...attachments] : undefined,
    };

    // Auto-title the thread on first user message
    if (activeThread.messages.length === 0 && text) {
      setThreads(prev => prev.map(t =>
        t.id === activeId
          ? { ...t, title: text.slice(0, 46) + (text.length > 46 ? '…' : ''), model: settings.model }
          : t
      ));
    }

    addMessage(activeId, userMsg);
    setInput('');
    setAttachments([]);
    setLoading(true);

    const hasImage = attachments.some(a => a.kind === 'image');
    const routedModel = hasImage ? 'llava:13b' : settings.model;

    // Try real backend, fall back to canned response
    let replyText = '';
    let latency = '';
    let pod = 'pod/x2p7q';

    const t0 = Date.now();
    try {
      const formData = new FormData();
      formData.append('message', text);
      formData.append('model', routedModel);
      formData.append('temperature', settings.temp.toString());
      formData.append('top_p', settings.topP.toString());
      formData.append('max_tokens', settings.maxTokens.toString());
      formData.append('system', settings.system);
      attachments.forEach(a => {
        if (a.file) formData.append('files', a.file);
        if (a.kind === 'image' && a.dataUrl) formData.append('images', a.dataUrl);
      });

      const res = await fetch(`http://${hostname}:5000/api/chat`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('non-200');
      const data = await res.json();
      replyText = data.reply || data.message || data.content || 'No response.';
      latency = `${Date.now() - t0}ms`;
    } catch {
      // Fall back to canned response
      await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
      replyText = pickResponse(text, attachments);
      latency = `${Math.round(180 + Math.random() * 120)}ms`;
    }

    await simulateStream(replyText);

    const assistantMsg: ChatMessage = {
      id: genId(),
      role: 'assistant',
      model: routedModel,
      latency,
      pod,
      content: replyText,
    };
    addMessage(activeId, assistantMsg);

    if (settings.voice && window.speechSynthesis) {
      const utt = new SpeechSynthesisUtterance(replyText.slice(0, 400));
      window.speechSynthesis.speak(utt);
    }

    setLoading(false);
  }, [input, attachments, activeThread, activeId, settings, hostname, addMessage, simulateStream]);

  // ── Attach files ──

  const handleAttach = useCallback((files: FileList) => {
    const newAtts: Attachment[] = [];
    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setAttachments(prev => [...prev, {
            kind: 'image',
            name: file.name,
            size: `${(file.size / 1024).toFixed(1)} KB`,
            dataUrl: reader.result as string,
            file,
          }]);
        };
        reader.readAsDataURL(file);
      } else {
        const ext = file.name.split('.').pop()?.toUpperCase() ?? 'FILE';
        newAtts.push({ kind: 'file', name: file.name, ext, size: `${(file.size / 1024).toFixed(1)} KB`, file });
      }
    });
    if (newAtts.length) setAttachments(prev => [...prev, ...newAtts]);
  }, []);

  // ── STT ──

  const toggleMic = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    recognitionRef.current = rec;
    rec.onresult = (e: any) => {
      setInput(prev => (prev + ' ' + e.results[0][0].transcript).trimStart());
      setIsListening(false);
    };
    rec.onerror = () => setIsListening(false);
    rec.onend   = () => setIsListening(false);
    rec.start();
    setIsListening(true);
  }, [isListening]);

  // ── TTS ──

  const handleSpeak = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utt);
  }, []);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  // ── Suggest click ──

  const handleSuggest = useCallback((text: string) => {
    setInput(text);
    setView('chat');
  }, []);

  // ── Model select from Models view ──

  const handleModelSelect = useCallback((m: string) => {
    setSettings(s => ({ ...s, model: m }));
    setView('chat');
  }, []);

  const runningPods = POD_ROWS.filter(p => p.status === 'Running').length;
  const messages    = activeThread?.messages ?? [];
  const hasImages   = attachments.some(a => a.kind === 'image');

  return (
    <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <TopBar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(c => !c)}
        view={view}
        onViewChange={setView}
        clusterOnline={clusterOnline}
        podCount={runningPods}
        podTotal={POD_ROWS.length}
        settings={settings}
        onSettingsOpen={() => setSettingsOpen(true)}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        onMobileOverlay={() => setMobileOverlay(true)}
        activeThread={activeThread}
      />

      {!sidebarCollapsed && (
        <Sidebar
          collapsed={sidebarCollapsed}
          threads={threads}
          activeId={activeId}
          onSelect={handleSelectThread}
          onNewChat={handleNewChat}
          view={view}
          onViewChange={setView}
        />
      )}

      <main className="main">
        {view === 'cluster' && <ClusterView online={clusterOnline} />}
        {view === 'models'  && <ModelsView activeModel={settings.model} onSelect={handleModelSelect} />}

        {view === 'chat' && (
          <>
            <div className="chat-thread">
              <div className="thread-inner">
                {messages.length === 0 && !loading && (
                  <EmptyState onSuggest={handleSuggest} />
                )}

                {messages.map((msg, idx) => {
                  // Check if the previous user message had images
                  const prevUserMsg = idx > 0 && messages[idx - 1].role === 'user'
                    ? messages[idx - 1]
                    : null;
                  const prevHadImage = prevUserMsg?.attachments?.some(a => a.kind === 'image') ?? false;
                  return (
                    <Message
                      key={msg.id}
                      msg={msg}
                      onCopy={handleCopy}
                      onSpeak={handleSpeak}
                      hasImageAttach={msg.role === 'assistant' && prevHadImage}
                    />
                  );
                })}

                {loading && (
                  <div className="msg assistant">
                    <div className="msg-avatar">Λ</div>
                    <div className="msg-body">
                      <div className="msg-head">
                        <span className="model">{hasImages ? 'llava:13b' : settings.model}</span>
                        <span className="latency">generating…</span>
                      </div>
                      {streamText
                        ? <MessageRender content={streamText} streaming />
                        : (
                          <div className="msg-bubble" style={{ display: 'flex', gap: 6, alignItems: 'center', paddingLeft: 0 }}>
                            {[0, 1, 2].map(i => (
                              <span key={i} style={{
                                width: 6, height: 6, borderRadius: '50%',
                                background: 'var(--ink-3)',
                                animation: `blink 1.2s ${i * 0.2}s steps(1) infinite`,
                              }} />
                            ))}
                          </div>
                        )
                      }
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            <Composer
              value={input}
              onChange={setInput}
              onSend={handleSend}
              loading={loading}
              isListening={isListening}
              onToggleMic={toggleMic}
              attachments={attachments}
              onAttach={handleAttach}
              onRemoveAttach={i => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
              model={settings.model}
            />
          </>
        )}

        <SettingsDrawer
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          settings={settings}
          onChange={setSettings}
          density={density}
          onDensityChange={d => {
            setDensity(d);
            document.documentElement.dataset.density = d;
          }}
          theme={theme}
          onThemeChange={t => {
            setTheme(t);
            document.documentElement.dataset.theme = t;
          }}
        />
      </main>

      {mobileOverlay && (
        <MobileOverlay
          onClose={() => setMobileOverlay(false)}
          messages={messages}
          streaming={streamText}
          model={settings.model}
          online={clusterOnline}
        />
      )}
    </div>
  );
}
