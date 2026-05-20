import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import './App.css';
import { Attachment, ChatMessage, Thread, Settings, View, CurrentUser } from './types';
import {
  resolveVisionModel,
  genId,
  apiToThread,
  apiMsgToLocal,
} from './lib/helpers';

import ForgotPasswordPage from './components/ForgotPasswordPage';
import LoginPage          from './components/LoginPage';
import TopBar             from './components/TopBar';
import Sidebar            from './components/Sidebar';
import EmptyState         from './components/EmptyState';
import Composer           from './components/Composer';
import ClusterView        from './components/ClusterView';
import ModelsView         from './components/ModelsView';
import AdminView          from './components/AdminView';
import ApiDocsView        from './components/ApiDocsView';
import SettingsDrawer     from './components/SettingsDrawer';
import MobileOverlay      from './components/MobileOverlay';
import Message, { MessageRender } from './components/Message';

export default function App() {
  // ── Auth state ──
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('ollama_token'));
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

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

  useEffect(() => {
    document.documentElement.dataset.theme   = theme;
    document.documentElement.dataset.density = density;
  }, [theme, density]);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
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

  useEffect(() => {
    if (!token) return;
    fetch(`/api/conversations`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(convs => {
        if (Array.isArray(convs)) {
          setThreads(convs.map(apiToThread));
          if (convs.length > 0) setActiveId(convs[0]._id);
        }
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`/health`);
        setClusterOnline(r.ok);
        if (r.ok && token) {
          fetch(`/api/cluster/status`, { headers: { Authorization: `Bearer ${token}` } })
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threads, streamText]);

  const activeThread = useMemo(() => threads.find(t => t.id === activeId), [threads, activeId]);

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
      fetch(`/api/conversations`, { headers: { Authorization: `Bearer ${tok}` } })
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

  const handleLogout = () => {
    localStorage.removeItem('ollama_token');
    setToken(null);
    setCurrentUser(null);
    setThreads([]);
    setActiveId('');
  };

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

  const handleSelectThread = useCallback(async (id: string) => {
    setActiveId(id);
    setView('chat');
    const thread = threads.find(t => t.id === id);
    if (thread && thread.messages.length === 0 && token) {
      try {
        const res = await fetch(`/api/conversations/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const conv = await res.json();
        const messages = (conv.messages || []).map(apiMsgToLocal);
        setThreads(prev => prev.map(t => t.id === id ? { ...t, messages } : t));
      } catch {}
    }
  }, [threads, token]);

  const handleDeleteThread = useCallback(async (id: string) => {
    if (!token) return;
    await fetch(`/api/conversations/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    setThreads(prev => prev.filter(t => t.id !== id));
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

  const handleExport = useCallback(async (format: 'json' | 'markdown') => {
    if (!activeId || !token) return;
    try {
      const res = await fetch(`/api/conversations/${activeId}/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = format === 'markdown' ? 'md' : 'json';
      const safeTitle = (activeThread?.title || 'conversation').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').slice(0, 50);
      a.download = `${safeTitle || 'conversation'}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed: ' + (err instanceof Error ? err.message : 'unknown error'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, token]);

  // ── Real streaming via SSE ──
  const streamFromBackend = useCallback(async (
    url: string,
    formData: FormData,
    authToken: string,
  ): Promise<{ reply: string; latency: string }> => {
    setStreamText('');
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: formData,
    });
    if (!res.ok || !res.body) {
      let errMsg = `Backend error (HTTP ${res.status})`;
      try {
        const errData = await res.json();
        if (errData.error) errMsg = errData.error;
      } catch {}
      throw new Error(errMsg);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let reply = '';
    let latency = '';
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
          if (obj.token) {
            reply += obj.token;
            setStreamText(reply);
          }
          if (obj.error)   throw new Error(obj.error);
          if (obj.done && obj.latency) latency = obj.latency;
        } catch (e) {
          if (e instanceof Error && e.message) throw e;
        }
      }
    }
    setStreamText('');
    return { reply: reply || 'No response.', latency };
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (!token) return;

    let currentActiveId = activeId;

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

      const result = await streamFromBackend(
        `/api/conversations/${currentActiveId}/messages?stream=true`,
        formData,
        token,
      );
      replyText = result.reply;
      latency = result.latency || `${Date.now() - t0}ms`;

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
      setStreamText('');
    }

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
  }, [input, attachments, activeId, token, settings, addMessage, streamFromBackend]);

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

  const handleSpeak = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utt);
  }, []);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  const handleSuggest = useCallback((text: string) => {
    setInput(text);
    setView('chat');
  }, []);

  const handleModelSelect = useCallback((m: string) => {
    setSettings(s => ({ ...s, model: m }));
    setView('chat');
  }, []);

  const messages  = activeThread?.messages ?? [];
  const hasImages = attachments.some(a => a.kind === 'image');

  if (!token) {
    if (showForgotPassword) {
      return <ForgotPasswordPage onBack={() => setShowForgotPassword(false)} />;
    }
    return (
      <LoginPage
        form={loginForm}
        onChange={setLoginForm}
        onSubmit={handleLogin}
        error={loginError}
        loading={loginLoading}
        onForgotPassword={() => setShowForgotPassword(true)}
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
        onExport={handleExport}
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
          <ModelsView activeModel={settings.model} onSelect={handleModelSelect} token={token} isAdmin={currentUser?.role === 'admin'} />
        )}
        {view === 'admin' && currentUser?.role === 'admin' && (
          <AdminView token={token} />
        )}
        {view === 'apidocs' && (
          <ApiDocsView baseUrl={`${window.location.protocol}//${window.location.host}`} />
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
