import React, { useMemo } from 'react';
import { Thread, View, CurrentUser } from '../types';
import { IcoPlus, IcoUsers, IcoLogOut, IcoTrash } from '../icons';

interface SidebarProps {
  collapsed: boolean;
  threads: Thread[];
  activeId: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDeleteThread: (id: string) => void;
  view: View;
  onViewChange: (v: View) => void;
  currentUser: CurrentUser | null;
  onLogout: () => void;
}

export default function Sidebar({
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
    navViews.push({ v: 'admin', label: 'Admin', icon: <IcoUsers /> });
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
