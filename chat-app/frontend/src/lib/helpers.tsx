import React from 'react';
import { ChatMessage, Thread } from '../types';

// Models that natively support image input
export const VISION_MODELS = new Set(['gemma3:4b', 'gemma3:12b', 'llava:7b']);
export const VISION_FALLBACK = 'gemma3:12b';

export function resolveVisionModel(selectedModel: string): string {
  return VISION_MODELS.has(selectedModel) ? selectedModel : VISION_FALLBACK;
}

export function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function computeGroup(dateStr: string): string {
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

export function computeTime(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (target.getTime() === today.getTime()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function apiMsgToLocal(m: any): ChatMessage {
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

export function apiToThread(conv: any): Thread {
  return {
    id: conv._id,
    title: conv.title || 'New conversation',
    model: conv.model || 'llama3:8b',
    time: computeTime(conv.updatedAt || conv.createdAt || new Date().toISOString()),
    group: computeGroup(conv.updatedAt || conv.createdAt || new Date().toISOString()),
    messages: (conv.messages || []).map(apiMsgToLocal),
  };
}

// Render message content: handle code fences and inline bold
export function renderContent(text: string): React.ReactNode[] {
  const blocks = text.split(/(```[\s\S]*?```)/g);
  return blocks.map((block, bi) => {
    if (block.startsWith('```')) {
      const inner = block.slice(3);
      const nlIdx = inner.indexOf('\n');
      const lang = nlIdx > -1 ? inner.slice(0, nlIdx).trim() : '';
      const code = nlIdx > -1 ? inner.slice(nlIdx + 1).replace(/```$/, '') : inner.replace(/```$/, '');
      return (
        <pre key={bi}>
          {lang && <div className="pre-head"><span>{lang}</span></div>}
          <code>{code}</code>
        </pre>
      );
    }
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

export function pwStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: '' };
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const map = [
    { score: 1, label: 'Weak',   color: '#f08570' },
    { score: 2, label: 'Fair',   color: '#f0c674' },
    { score: 3, label: 'Good',   color: '#7dd87a' },
    { score: 4, label: 'Strong', color: '#7dd87a' },
  ];
  return map[s - 1] ?? { score: 0, label: '', color: '' };
}

export function formatBytes(n: number | string | undefined): string {
  const num = typeof n === 'string' ? parseInt(n) : (n || 0);
  if (!num) return '—';
  if (num < 1024) return `${num} B`;
  if (num < 1024 ** 2) return `${(num / 1024).toFixed(1)} KB`;
  if (num < 1024 ** 3) return `${(num / 1024 ** 2).toFixed(1)} MB`;
  return `${(num / 1024 ** 3).toFixed(2)} GB`;
}
