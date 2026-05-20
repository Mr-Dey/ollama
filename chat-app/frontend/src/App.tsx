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

type View = 'chat' | 'cluster' | 'models' | 'admin' | 'apidocs';

// Models that natively support image input
const VISION_MODELS = new Set(['gemma3:4b', 'gemma3:12b', 'llava:7b']);
const VISION_FALLBACK = 'gemma3:12b';

function resolveVisionModel(selectedModel: string): string {
  return VISION_MODELS.has(selectedModel) ? selectedModel : VISION_FALLBACK;
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

function computeGroup(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (target.getTime() === today.getTime()) return 'Today';
  if (target.getTime() === yesterday.getTime()) return 'Yesterday';
  if (target >= weekAgo) return 'This week';
  return 'Older';
}

function computeTime(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (target.getTime() === today.getTime()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function apiToThread(conv: any): Thread {
  return {
    id: conv._id,
    title: conv.title || 'New conversation',
    model: conv.model || 'llama3:8b',
    time: computeTime(conv.updatedAt || conv.createdAt || new Date().toISOString()),
    group: computeGroup(conv.updatedAt || conv.createdAt || new Date().toISOString()),
    messages: (conv.messages || []).map(apiMsgToLocal),
  };
}

function apiMsgToLocal(m: any): ChatMessage {
  return {
    id: m._id || m.id || genId(),
    role: m.role,
    content: m.content,
    model: m.model,
    latency: m.latency,
    pod: m.pod,
    attachments: m.attachments,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
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
const IcoLogOut = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);
const IcoTrash = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6"/>
    <path d="M14 11v6"/>
    <path d="M9 6V4h6v2"/>
  </svg>
);
const IcoUsers = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);

// ─── LoginPage ────────────────────────────────────────────────────────────────

function LoginPage({
  form,
  onChange,
  onSubmit,
  error,
  loading,
}: {
  form: { username: string; password: string };
  onChange: (f: { username: string; password: string }) => void;
  onSubmit: (e: React.FormEvent) => void;
  error: string;
  loading: boolean;
}) {
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="glyph">Λ</div>
          <h2>Ollama Cluster</h2>
          <p>Sign in to your workspace</p>
        </div>
        <form onSubmit={onSubmit} className="login-form">
          <div className="field">
            <div className="label">Username</div>
            <input
              className="login-input"
              type="text"
              value={form.username}
              onChange={e => onChange({ ...form, username: e.target.value })}
              placeholder="username"
              autoFocus
              required
            />
          </div>
          <div className="field">
            <div className="label">Password</div>
            <input
              className="login-input"
              type="password"
              value={form.password}
              onChange={e => onChange({ ...form, password: e.target.value })}
              placeholder="••••••••"
              required
            />
          </div>
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in →'}
          </button>
        </form>
      </div>
    </div>
  );
}

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
  currentUser: { username: string; role: string; email?: string } | null;
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
  currentUser,
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

        {currentUser && (
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-4)' }}>
            {currentUser.username}
          </span>
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
  onDeleteThread: (id: string) => void;
  view: View;
  onViewChange: (v: View) => void;
  currentUser: { username: string; role: string; email?: string } | null;
  onLogout: () => void;
}

function Sidebar({
  collapsed,
  threads,
  activeId,
  onSelect,
  onNewChat,
  onDeleteThread,
  view,
  onViewChange,
  currentUser,
  onLogout,
}: SidebarProps) {
  const groups = useMemo(() => {
    const map: Record<string, Thread[]> = {};
    const order: string[] = [];
    for (const t of threads) {
      if (!map[t.group]) { map[t.group] = []; order.push(t.group); }
      map[t.group].push(t);
    }
    return order.map(g => ({ label: g, items: map[g] }));
  }, [threads]);

  const navViews: { v: View; label: string; icon: React.ReactNode }[] = [
    {
      v: 'chat',
      label: 'Chat',
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    },
    {
      v: 'models',
      label: 'Models',
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>,
    },
    {
      v: 'cluster',
      label: 'Cluster',
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>,
    },
  ];

  if (currentUser?.role === 'admin') {
    navViews.push({
      v: 'admin',
      label: 'Admin',
      icon: <IcoUsers />,
    });
  }

  navViews.push({
    v: 'apidocs',
    label: 'API Docs',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  });

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
          {navViews.map(({ v, label, icon }) => (
            <button
              key={v}
              className={`nav-item${view === v ? ' active' : ''}`}
              onClick={() => onViewChange(v)}
            >
              {icon}
              <span>{label}</span>
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
                <button
                  className="del-btn"
                  title="Delete conversation"
                  onClick={e => { e.stopPropagation(); onDeleteThread(t.id); }}
                >
                  <IcoTrash />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="side-foot">
        <div className="avatar">{currentUser?.username?.[0]?.toUpperCase() ?? 'U'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="who">{currentUser?.username ?? 'user'}</div>
          <div className="role">{currentUser?.role ?? 'member'}</div>
        </div>
        <button className="logout-btn" onClick={onLogout} title="Sign out">
          <IcoLogOut />
        </button>
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
            <span className="multi-modal-tag">llava:7b routed</span>
          </div>
        ))}

        {/* Multi-modal banner */}
        {hasImageAttach && msg.role === 'assistant' && (
          <div className="modal-route-banner">
            <span>routed</span>
            <span className="arrow">→</span>
            <span className="tag">llava:7b</span>
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
  micSupported: boolean;
  onToggleMic: () => void;
  attachments: Attachment[];
  onAttach: (files: FileList) => void;
  onRemoveAttach: (i: number) => void;
  model: string;
  visionModel: string;
}

function Composer({
  value, onChange, onSend, loading, isListening, micSupported, onToggleMic,
  attachments, onAttach, onRemoveAttach, model, visionModel,
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
          {VISION_MODELS.has(model)
            ? <><span>vision enabled</span><span className="arrow">→</span><span className="tag">{model}</span><span style={{ color: 'var(--ink-4)' }}>·</span><span style={{ color: 'var(--ink-3)' }}>native vision</span></>
            : <><span>routing to</span><span className="arrow">→</span><span className="tag">{visionModel}</span><span style={{ color: 'var(--ink-4)' }}>·</span><span style={{ color: 'var(--ink-3)' }}>vision model</span></>
          }
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
            className={`tool-btn icon-only${isListening ? ' mic-rec' : ''}${!micSupported ? ' mic-unavail' : ''}`}
            onClick={onToggleMic}
            title={!micSupported ? 'Voice input requires HTTPS' : isListening ? 'Stop recording' : 'Voice input'}
          >
            {!micSupported
              ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: 0, color: 'var(--warn)', whiteSpace: 'nowrap' }}>HTTPS only</span>
              : isListening
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

function ClusterView({ online, token }: { online: boolean; token: string }) {
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

  // Compute aggregate CPU/mem from nodes if available
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
          {/* Metrics */}
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

          {/* Nodes */}
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

          {/* Pods table */}
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
        </>
      )}
    </div>
  );
}

// ─── ModelsView ───────────────────────────────────────────────────────────────

function ModelsView({
  activeModel,
  onSelect,
  token,
}: {
  activeModel: string;
  onSelect: (m: string) => void;
  token: string;
}) {
  const [models, setModels] = useState<{ name: string; size: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  useEffect(() => {
    setModelsLoading(true);
    fetch(`/api/models`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setModels(data);
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false));
  }, [token]);

  return (
    <div className="cluster-view">
      <div className="cluster-head">
        <div>
          <div className="crumb">k3s-cluster / models</div>
          <h2>Models</h2>
        </div>
      </div>
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
              </tr>
            </thead>
            <tbody>
              {models.map(m => (
                <tr key={m.name} onClick={() => onSelect(m.name)} style={{ cursor: 'pointer' }}>
                  <td className={`pod-name${m.name === activeModel ? ' model' : ''}`}>{m.name}</td>
                  <td>{m.size ?? '—'}</td>
                  <td>
                    <span className="badge">
                      <span className="dot" />
                      {m.name === activeModel ? 'active' : 'ready'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── AdminView ────────────────────────────────────────────────────────────────

function AdminView({ token }: { token: string }) {
  const [users, setUsers] = useState<any[]>([]);
  const [adminLoading, setAdminLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user', email: '' });
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  const loadUsers = useCallback(() => {
    setAdminLoading(true);
    fetch(`/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setUsers(data); })
      .catch(() => {})
      .finally(() => setAdminLoading(false));
  }, [token]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    setAddLoading(true);
    try {
      const res = await fetch(`/api/admin/users`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });
      if (!res.ok) {
        const d = await res.json();
        setAddError(d.error || 'Failed to create user');
        return;
      }
      setNewUser({ username: '', password: '', role: 'user', email: '' });
      setShowAddForm(false);
      loadUsers();
    } catch {
      setAddError('Network error');
    } finally {
      setAddLoading(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!window.confirm('Delete this user?')) return;
    await fetch(`/api/admin/users/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    loadUsers();
  };

  return (
    <div className="cluster-view">
      <div className="cluster-head">
        <div>
          <div className="crumb">k3s-cluster / admin</div>
          <h2>User Management</h2>
        </div>
        <button
          onClick={() => setShowAddForm(v => !v)}
          style={{ padding: '8px 14px', background: 'var(--bone)', color: 'var(--bone-ink)', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
        >
          {showAddForm ? 'Cancel' : '+ Add user'}
        </button>
      </div>

      {showAddForm && (
        <div style={{ maxWidth: 1180, margin: '0 auto 24px', padding: 20, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--bg-elev)' }}>
          <form onSubmit={handleAddUser} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {[
              { label: 'Username', key: 'username', type: 'text', placeholder: 'username' },
              { label: 'Password', key: 'password', type: 'password', placeholder: '••••••••' },
              { label: 'Email', key: 'email', type: 'email', placeholder: 'user@example.com' },
            ].map(f => (
              <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{f.label}</div>
                <input
                  type={f.type}
                  placeholder={f.placeholder}
                  value={(newUser as any)[f.key]}
                  onChange={e => setNewUser(u => ({ ...u, [f.key]: e.target.value }))}
                  required={f.key !== 'email'}
                  style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 12px', color: 'var(--ink)', fontSize: 13, fontFamily: 'var(--font-sans)', outline: 'none' }}
                />
              </div>
            ))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Role</div>
              <select
                value={newUser.role}
                onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))}
                style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 12px', color: 'var(--ink)', fontSize: 13, fontFamily: 'var(--font-mono)', outline: 'none' }}
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>
            {addError && <div style={{ color: '#f87171', fontSize: 13, width: '100%' }}>{addError}</div>}
            <button
              type="submit"
              disabled={addLoading}
              style={{ padding: '8px 16px', background: 'var(--bone)', color: 'var(--bone-ink)', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)', opacity: addLoading ? 0.6 : 1 }}
            >
              {addLoading ? 'Creating…' : 'Create user'}
            </button>
          </form>
        </div>
      )}

      {adminLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          Loading users…
        </div>
      ) : (
        <div className="pod-table-wrap">
          <table className="pod-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Email</th>
                <th>Created</th>
                <th>Last Login</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u._id || u.id}>
                  <td className="pod-name">{u.username}</td>
                  <td>
                    <span className={`badge${u.role === 'admin' ? '' : ' warn'}`} style={u.role === 'admin' ? { borderColor: 'rgba(239,231,215,0.32)', background: 'rgba(239,231,215,0.08)', color: 'var(--bone)' } : {}}>
                      <span className="dot" />
                      {u.role}
                    </span>
                  </td>
                  <td>{u.email ?? '—'}</td>
                  <td className="age">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
                  <td className="age">{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : '—'}</td>
                  <td>
                    <button
                      onClick={() => handleDeleteUser(u._id || u.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', padding: '4px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontFamily: 'var(--font-mono)' }}
                      title="Delete user"
                    >
                      <IcoTrash />
                      delete
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-4)', padding: 32 }}>No users found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── ApiDocsView ──────────────────────────────────────────────────────────────

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
        response: JSON.stringify({ _id: '...', username: 'admin', role: 'admin', email: 'admin@ollama.local', createdAt: '2026-05-15T00:00:00Z', lastLogin: '2026-05-20T10:00:00Z' }, null, 2),
      },
    ],
  },
  {
    label: 'Conversations',
    endpoints: [
      {
        method: 'GET', path: '/api/conversations', auth: 'bearer',
        desc: 'List all conversations for the authenticated user, sorted by most recently updated.',
        response: JSON.stringify([{ _id: '...', title: 'My first chat', model: 'qwen3:8b', createdAt: '...', updatedAt: '...' }], null, 2),
      },
      {
        method: 'POST', path: '/api/conversations', auth: 'bearer',
        desc: 'Create a new empty conversation.',
        body: JSON.stringify({ title: 'My chat', model: 'qwen3:8b' }, null, 2),
        response: JSON.stringify({ _id: '664abc...', title: 'My chat', model: 'qwen3:8b', messages: [], createdAt: '...', updatedAt: '...' }, null, 2),
      },
      {
        method: 'GET', path: '/api/conversations/:id', auth: 'bearer',
        desc: 'Fetch a conversation including its full message history.',
        response: JSON.stringify({ _id: '...', title: 'My chat', model: 'qwen3:8b', messages: [{ role: 'user', content: 'Hello', createdAt: '...' }, { role: 'assistant', content: 'Hi!', model: 'qwen3:8b', latency: '1230ms', createdAt: '...' }] }, null, 2),
      },
      {
        method: 'DELETE', path: '/api/conversations/:id', auth: 'bearer',
        desc: 'Delete a conversation and all its messages.',
        response: JSON.stringify({ ok: true }, null, 2),
      },
    ],
  },
  {
    label: 'Messages',
    endpoints: [
      {
        method: 'POST', path: '/api/conversations/:id/messages', auth: 'bearer',
        desc: 'Send a message to a conversation and get an AI reply. Supports file and image uploads via multipart/form-data. Images auto-route to a vision model.',
        body: `// multipart/form-data fields:
message    : "Summarize this document"   // required
model      : "qwen3:8b"                  // optional, overrides conversation model
temperature: "0.7"                       // optional
top_p      : "0.9"                       // optional
max_tokens : "2048"                      // optional
system     : "You are a helpful..."      // optional
files      : <File>                      // optional, attach PDF/TXT/MD/JS/TS etc.
images     : "data:image/png;base64,..." // optional, base64 image for vision`,
        response: JSON.stringify({ reply: 'The document discusses...', model: 'qwen3:8b', latency: '2340ms', conversationId: '664abc...' }, null, 2),
        note: 'If images are attached, the model is automatically switched to a vision-capable model (gemma3:12b if current model has no vision support).',
      },
    ],
  },
  {
    label: 'Models',
    endpoints: [
      {
        method: 'GET', path: '/api/models', auth: 'bearer',
        desc: 'List all models currently available on the Ollama cluster.',
        response: JSON.stringify([{ name: 'qwen3:8b', size: 5200000000 }, { name: 'gemma3:12b', size: 8100000000 }, { name: 'deepseek-r1:8b', size: 5200000000 }], null, 2),
      },
    ],
  },
  {
    label: 'Cluster',
    endpoints: [
      {
        method: 'GET', path: '/api/cluster/status', auth: 'bearer',
        desc: 'Returns live cluster metrics: node CPU/memory usage, pod list, and available models. Reads from the Kubernetes in-cluster API.',
        response: JSON.stringify({
          nodes: [{ name: 'k3s-node-1', role: 'master', ip: '172.16.9.203', cpu: 10, mem: 7, pods: 11 }],
          pods: [{ name: 'ollama-xxx', namespace: 'default', status: 'Running', ready: '1/1', restarts: 0, age: '2026-05-15T03:53:34Z' }],
          models: [{ name: 'qwen3:8b', size: 5200000000 }],
        }, null, 2),
      },
    ],
  },
  {
    label: 'Admin — User Management',
    endpoints: [
      {
        method: 'GET', path: '/api/admin/users', auth: 'admin',
        desc: 'List all users. Requires admin role.',
        response: JSON.stringify([{ _id: '...', username: 'admin', role: 'admin', email: 'admin@ollama.local', createdAt: '...', lastLogin: '...' }], null, 2),
      },
      {
        method: 'POST', path: '/api/admin/users', auth: 'admin',
        desc: 'Create a new user. Requires admin role.',
        body: JSON.stringify({ username: 'newuser', password: 'pass123', role: 'user', email: 'user@example.com' }, null, 2),
        response: JSON.stringify({ id: '...', username: 'newuser', role: 'user', email: 'user@example.com' }, null, 2),
      },
      {
        method: 'DELETE', path: '/api/admin/users/:id', auth: 'admin',
        desc: 'Delete a user and all their conversations. Cannot delete your own account.',
        response: JSON.stringify({ ok: true }, null, 2),
      },
      {
        method: 'PATCH', path: '/api/admin/users/:id/password', auth: 'admin',
        desc: 'Change a user\'s password. Requires admin role.',
        body: JSON.stringify({ password: 'newpassword123' }, null, 2),
        response: JSON.stringify({ ok: true }, null, 2),
      },
    ],
  },
  {
    label: 'Health',
    endpoints: [
      {
        method: 'GET', path: '/health', auth: 'none',
        desc: 'Health check endpoint. Returns MongoDB and Ollama connectivity status. No authentication required.',
        response: JSON.stringify({ status: 'ok', mongo: true, ollama: true }, null, 2),
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

function ApiDocsView({ baseUrl }: { baseUrl: string }) {
  const [openIdx, setOpenIdx] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
  };

  const makeCurl = (ep: Endpoint): string => {
    const authHeader = ep.auth !== 'none'
      ? `\\\n  -H "Authorization: Bearer $TOKEN" `
      : '';
    const contentType = ep.body && !ep.body.startsWith('//')
      ? `\\\n  -H "Content-Type: application/json" `
      : '';
    const bodyFlag = ep.body && !ep.body.startsWith('//')
      ? `\\\n  -d '${ep.body.replace(/\n\s*/g, ' ')}' `
      : '';
    return `curl -X ${ep.method} "${baseUrl}${ep.path}" ${authHeader}${contentType}${bodyFlag}`.trim();
  };

  const filtered = search.trim()
    ? API_GROUPS.map(g => ({
        ...g,
        endpoints: g.endpoints.filter(e =>
          e.path.toLowerCase().includes(search.toLowerCase()) ||
          e.desc.toLowerCase().includes(search.toLowerCase()) ||
          e.method.toLowerCase().includes(search.toLowerCase())
        ),
      })).filter(g => g.endpoints.length > 0)
    : API_GROUPS;

  return (
    <div className="cluster-view">
      <div className="cluster-head">
        <div>
          <div className="crumb">k3s-cluster / api-reference</div>
          <h2>API Reference</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
            Base URL
          </div>
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

      {/* Auth note */}
      <div style={{ maxWidth: 1180, margin: '0 auto 20px', padding: '14px 18px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--bg-elev)', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.7 }}>
        <span style={{ color: 'var(--bone)', fontWeight: 600 }}>Authentication: </span>
        Get a token via <span style={{ color: 'var(--ink-2)' }}>POST /api/auth/login</span>, then send it as{' '}
        <span style={{ color: 'var(--ink-2)' }}>Authorization: Bearer &lt;token&gt;</span> on protected routes.
        <span style={{ marginLeft: 16, color: '#f0c674' }}>Admin</span> routes additionally require <span style={{ color: 'var(--ink-2)' }}>role: "admin"</span> on the JWT.
      </div>

      {/* Search */}
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
                  {/* Header row */}
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

                  {/* Expanded detail */}
                  {isOpen && (
                    <div style={{ borderTop: '1px solid var(--line)', padding: '18px 18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {/* Description */}
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>{ep.desc}</p>
                      {ep.note && <p style={{ margin: 0, fontSize: 12, color: 'var(--warn)', fontFamily: 'var(--font-mono)', background: 'var(--warn-soft)', border: '1px solid rgba(240,198,116,0.25)', borderRadius: 6, padding: '8px 12px', lineHeight: 1.6 }}>ℹ {ep.note}</p>}

                      <div style={{ display: 'grid', gridTemplateColumns: ep.body ? '1fr 1fr' : '1fr', gap: 14 }}>
                        {/* Request body */}
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
                        {/* Response */}
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

                      {/* cURL */}
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
            <optgroup label="Qwen3 (latest)">
              <option value="qwen3:0.6b">qwen3:0.6b — 522 MB</option>
              <option value="qwen3:1.7b">qwen3:1.7b — 1.4 GB</option>
              <option value="qwen3:4b">qwen3:4b — 2.5 GB</option>
              <option value="qwen3:8b">qwen3:8b — 5.2 GB</option>
            </optgroup>
            <optgroup label="Qwen2.5">
              <option value="qwen2.5:3b">qwen2.5:3b — 1.9 GB</option>
              <option value="qwen2.5:7b">qwen2.5:7b — 4.7 GB</option>
            </optgroup>
            <optgroup label="Gemma3 (latest)">
              <option value="gemma3:4b">gemma3:4b — 3.3 GB · vision</option>
              <option value="gemma3:12b">gemma3:12b — 8.1 GB · vision</option>
            </optgroup>
            <optgroup label="Gemma3n">
              <option value="gemma3n:e2b">gemma3n:e2b — 5.6 GB</option>
              <option value="gemma3n:e4b">gemma3n:e4b — 7.5 GB</option>
            </optgroup>
            <optgroup label="DeepSeek-R1 (reasoning)">
              <option value="deepseek-r1:1.5b">deepseek-r1:1.5b — 1.1 GB</option>
              <option value="deepseek-r1:7b">deepseek-r1:7b — 4.7 GB</option>
              <option value="deepseek-r1:8b">deepseek-r1:8b — 5.2 GB</option>
            </optgroup>
            <optgroup label="Legacy">
              <option value="llama3:8b">llama3:8b — 4.7 GB</option>
              <option value="gemma:7b">gemma:7b — 5.0 GB</option>
              <option value="gemma2:2b">gemma2:2b — 1.6 GB</option>
            </optgroup>
            <optgroup label="Vision">
              <option value="llava:7b">llava:7b — 4.7 GB · vision</option>
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
  // ── Auth state ──
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('ollama_token'));
  const [currentUser, setCurrentUser] = useState<{ username: string; role: string; email?: string } | null>(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // ── Threads ──
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string>('');

  // ── Navigation ──
  const [view, setView]                       = useState<View>('chat');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen]       = useState(false);
  const [mobileOverlay, setMobileOverlay]     = useState(false);

  // ── Settings ──
  const [settings, setSettings] = useState<Settings>({
    model: 'qwen3:8b',
    temp: 0.7,
    topP: 0.9,
    maxTokens: 2048,
    stream: true,
    voice: false,
    system: 'You are a helpful AI assistant running on a self-hosted k3s cluster with Ollama.',
  });
  const [density, setDensity] = useState('regular');
  const [theme, setTheme]     = useState<'dark' | 'light'>('dark');

  // ── Chat state ──
  const [input, setInput]             = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading]         = useState(false);
  const [streamText, setStreamText]   = useState('');

  // ── Cluster health ──
  const [clusterOnline, setClusterOnline] = useState(false);
  const [podCount, setPodCount]           = useState(0);
  const [podTotal, setPodTotal]           = useState(0);

  // ── STT ──
  const [isListening, setIsListening] = useState(false);
  const [micSupported, setMicSupported] = useState(true);
  const recognitionRef = useRef<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Apply theme + density
  useEffect(() => {
    document.documentElement.dataset.theme   = theme;
    document.documentElement.dataset.density = density;
  }, [theme, density]);

  // ── Validate token on mount (once) ──
  useEffect(() => {
    if (!token) return;
    fetch(`/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => {
        if (!r.ok) {
          localStorage.removeItem('ollama_token');
          setToken(null);
          return null;
        }
        return r.json();
      })
      .then(u => { if (u) setCurrentUser(u); })
      .catch(() => setToken(null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load conversations when token is available ──
  useEffect(() => {
    if (!token) return;
    fetch(`/api/conversations`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(convs => {
        if (Array.isArray(convs)) {
          setThreads(convs.map(apiToThread));
          if (convs.length > 0) setActiveId(convs[0]._id);
        }
      })
      .catch(() => {});
  }, [token]);

  // ── Health poll every 5s ──
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`/health`);
        setClusterOnline(r.ok);
        if (r.ok && token) {
          // Update pod counts from cluster status
          fetch(`/api/cluster/status`, {
            headers: { Authorization: `Bearer ${token}` },
          })
            .then(rr => rr.json())
            .then(data => {
              if (data.pods) {
                setPodTotal(data.pods.length);
                setPodCount(data.pods.filter((p: any) => p.status === 'Running').length);
              }
            })
            .catch(() => {});
        }
      } catch {
        setClusterOnline(false);
      }
    };
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, [token]);

  // ── Scroll to bottom ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threads, streamText]);

  const activeThread = useMemo(() => threads.find(t => t.id === activeId), [threads, activeId]);

  // ── Login ──
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const res = await fetch(`/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginForm.username, password: loginForm.password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setLoginError(d.error || d.message || 'Invalid credentials');
        return;
      }
      const data = await res.json();
      const tok = data.token;
      localStorage.setItem('ollama_token', tok);
      setToken(tok);
      if (data.user) setCurrentUser(data.user);
      // Load conversations
      fetch(`/api/conversations`, {
        headers: { Authorization: `Bearer ${tok}` },
      })
        .then(r => r.json())
        .then(convs => {
          if (Array.isArray(convs)) {
            setThreads(convs.map(apiToThread));
            if (convs.length > 0) setActiveId(convs[0]._id);
          }
        })
        .catch(() => {});
    } catch {
      setLoginError('Network error. Check backend connection.');
    } finally {
      setLoginLoading(false);
    }
  };

  // ── Logout ──
  const handleLogout = () => {
    localStorage.removeItem('ollama_token');
    setToken(null);
    setCurrentUser(null);
    setThreads([]);
    setActiveId('');
  };

  // ── New chat ──
  const handleNewChat = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/conversations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: settings.model }),
      });
      const conv = await res.json();
      const t = apiToThread(conv);
      setThreads(prev => [t, ...prev]);
      setActiveId(conv._id);
      setView('chat');
    } catch {
      // Fallback: create a local-only thread
      const id = genId();
      const t: Thread = {
        id,
        title: 'New conversation',
        model: settings.model,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        group: 'Today',
        messages: [],
      };
      setThreads(prev => [t, ...prev]);
      setActiveId(id);
      setView('chat');
    }
  }, [token, settings.model]);

  // ── Select thread (lazy-load messages) ──
  const handleSelectThread = useCallback(async (id: string) => {
    setActiveId(id);
    setView('chat');
    // Lazy-load messages if not yet loaded
    const thread = threads.find(t => t.id === id);
    if (thread && thread.messages.length === 0 && token) {
      try {
        const res = await fetch(`/api/conversations/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const conv = await res.json();
        const messages = (conv.messages || []).map(apiMsgToLocal);
        setThreads(prev => prev.map(t => t.id === id ? { ...t, messages } : t));
      } catch {
        // ignore
      }
    }
  }, [threads, token]);

  // ── Delete thread ──
  const handleDeleteThread = useCallback(async (id: string) => {
    if (!token) return;
    await fetch(`/api/conversations/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    setThreads(prev => {
      const next = prev.filter(t => t.id !== id);
      return next;
    });
    if (activeId === id) {
      setThreads(prev => {
        const next = prev.filter(t => t.id !== id);
        setActiveId(next[0]?.id ?? '');
        return next;
      });
    }
  }, [token, activeId]);

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
        const delay = 16 + Math.random() * 14;
        setTimeout(tick, delay);
      };
      tick();
    });
  }, []);

  // ── Send message ──
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (!token) return;

    let currentActiveId = activeId;

    // If no active conversation, create one first
    if (!currentActiveId) {
      try {
        const res = await fetch(`/api/conversations`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: settings.model }),
        });
        const conv = await res.json();
        const newThread = apiToThread(conv);
        setThreads(prev => [newThread, ...prev]);
        setActiveId(conv._id);
        currentActiveId = conv._id;
      } catch {
        return;
      }
    }

    const userMsg: ChatMessage = {
      id: genId(),
      role: 'user',
      content: text,
      attachments: attachments.length > 0 ? [...attachments] : undefined,
    };

    // Optimistically add user message
    addMessage(currentActiveId, userMsg);
    setInput('');
    setAttachments([]);
    setLoading(true);

    const hasImage = attachments.some(a => a.kind === 'image');
    const routedModel = hasImage ? resolveVisionModel(settings.model) : settings.model;

    let replyText = '';
    let latency = '';
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

      const res = await fetch(
        `/api/conversations/${currentActiveId}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        }
      );

      if (!res.ok) {
        let errMsg = `Backend error (HTTP ${res.status})`;
        try {
          const errData = await res.json();
          if (errData.error) errMsg = errData.error;
        } catch {}
        throw new Error(errMsg);
      }
      const data = await res.json();
      replyText = data.reply || data.message || data.content || 'No response.';
      latency = data.latency ? `${data.latency}` : `${Date.now() - t0}ms`;

      // Update thread title if it was 'New conversation'
      if (text) {
        setThreads(prev => prev.map(t =>
          t.id === currentActiveId && (t.title === 'New conversation' || t.title === '')
            ? { ...t, title: text.slice(0, 46) + (text.length > 46 ? '…' : ''), model: routedModel }
            : t
        ));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      replyText = `**Error:** Could not get a response from \`${routedModel}\`.\n\n\`${msg}\`\n\nCheck that the model is pulled on the cluster (see **Models** view), or select a different model in Settings.`;
      latency = `${Date.now() - t0}ms`;
    }

    await simulateStream(replyText);

    const assistantMsg: ChatMessage = {
      id: genId(),
      role: 'assistant',
      model: routedModel,
      latency,
      content: replyText,
    };
    addMessage(currentActiveId, assistantMsg);

    if (settings.voice && window.speechSynthesis) {
      const utt = new SpeechSynthesisUtterance(replyText.slice(0, 400));
      window.speechSynthesis.speak(utt);
    }

    setLoading(false);
  }, [input, attachments, activeId, token, settings, addMessage, simulateStream]);

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
    if (!SR) {
      setMicSupported(false);
      setTimeout(() => setMicSupported(true), 3000);
      return;
    }
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

  const messages  = activeThread?.messages ?? [];
  const hasImages = attachments.some(a => a.kind === 'image');

  // ── Not logged in → show login page ──
  if (!token) {
    return (
      <LoginPage
        form={loginForm}
        onChange={setLoginForm}
        onSubmit={handleLogin}
        error={loginError}
        loading={loginLoading}
      />
    );
  }

  return (
    <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <TopBar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(c => !c)}
        view={view}
        onViewChange={setView}
        clusterOnline={clusterOnline}
        podCount={podCount}
        podTotal={podTotal}
        settings={settings}
        onSettingsOpen={() => setSettingsOpen(true)}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        onMobileOverlay={() => setMobileOverlay(true)}
        activeThread={activeThread}
        currentUser={currentUser}
      />

      <Sidebar
        collapsed={sidebarCollapsed}
        threads={threads}
        activeId={activeId}
        onSelect={handleSelectThread}
        onNewChat={handleNewChat}
        onDeleteThread={handleDeleteThread}
        view={view}
        onViewChange={setView}
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      <main className="main">
        {view === 'cluster' && (
          <ClusterView online={clusterOnline} token={token} />
        )}
        {view === 'models' && (
          <ModelsView activeModel={settings.model} onSelect={handleModelSelect} token={token} />
        )}
        {view === 'admin' && currentUser?.role === 'admin' && (
          <AdminView token={token} />
        )}
        {view === 'apidocs' && (
          <ApiDocsView baseUrl={`http://${window.location.host}`} />
        )}

        {view === 'chat' && (
          <>
            <div className="chat-thread">
              <div className="thread-inner">
                {messages.length === 0 && !loading && (
                  <EmptyState onSuggest={handleSuggest} />
                )}

                {messages.map((msg, idx) => {
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
                        <span className="model">{hasImages ? resolveVisionModel(settings.model) : settings.model}</span>
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
              micSupported={micSupported}
              onToggleMic={toggleMic}
              attachments={attachments}
              onAttach={handleAttach}
              onRemoveAttach={i => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
              model={settings.model}
              visionModel={resolveVisionModel(settings.model)}
            />
          </>
        )}

      </main>

      {settingsOpen && <div className="settings-overlay" onClick={() => setSettingsOpen(false)} />}
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
