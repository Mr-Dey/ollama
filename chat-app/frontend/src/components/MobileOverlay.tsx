import React from 'react';
import { ChatMessage } from '../types';
import { IcoSend } from '../icons';

interface MobileOverlayProps {
  onClose: () => void;
  messages: ChatMessage[];
  streaming: string;
  model: string;
  online: boolean;
}

export default function MobileOverlay({ onClose, messages, streaming, model, online }: MobileOverlayProps) {
  const last4 = messages.slice(-4);
  return (
    <div className="mobile-overlay" onClick={onClose}>
      <div className="device-wrap" onClick={e => e.stopPropagation()}>
        <div style={{
          width: 320, height: 580, borderRadius: 36,
          background: 'var(--bg-elev)', border: '3px solid var(--line-strong)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.5)', overflow: 'hidden', display: 'flex', flexDirection: 'column',
          position: 'relative',
        }}>
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
