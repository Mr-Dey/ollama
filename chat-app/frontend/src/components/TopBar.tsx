import React, { useState } from 'react';
import { View, Settings, Thread, CurrentUser } from '../types';
import { IcoPanelLeft, IcoSettings, IcoMoon, IcoSun, IcoPhone } from '../icons';

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
  currentUser: CurrentUser | null;
  onExport?: (format: 'json' | 'markdown') => void;
}

export default function TopBar({
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
  onExport,
}: TopBarProps) {
  const [exportOpen, setExportOpen] = useState(false);
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
            {onExport && activeThread.messages.length > 0 && (
              <div style={{ position: 'relative' }}>
                <button
                  className="icon-btn"
                  style={{ fontSize: 11, padding: '4px 8px', fontFamily: 'var(--font-mono)', color: 'var(--ink-3)' }}
                  onClick={() => setExportOpen(o => !o)}
                  title="Export conversation"
                >
                  ↓ export
                </button>
                {exportOpen && (
                  <div className="export-menu" onMouseLeave={() => setExportOpen(false)}>
                    <button onClick={() => { onExport('markdown'); setExportOpen(false); }}>Markdown (.md)</button>
                    <button onClick={() => { onExport('json'); setExportOpen(false); }}>JSON (.json)</button>
                  </div>
                )}
              </div>
            )}
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
