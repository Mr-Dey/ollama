import React from 'react';
import { ChatMessage } from '../types';
import { renderContent } from '../lib/helpers';
import { IcoCopy, IcoVolume, IcoRefresh } from '../icons';

export function MessageRender({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div className="msg-bubble">
      {renderContent(content)}
      {streaming && <span className="cursor" />}
    </div>
  );
}

interface MsgProps {
  msg: ChatMessage;
  onCopy: (text: string) => void;
  onSpeak: (text: string) => void;
  streaming?: boolean;
  hasImageAttach?: boolean;
}

export default function Message({ msg, onCopy, onSpeak, streaming, hasImageAttach }: MsgProps) {
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

        {msg.attachments?.filter(a => a.kind === 'image').map((a, i) => (
          <div key={i} className="attach-image">
            {a.dataUrl
              ? <img src={a.dataUrl} alt="upload" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div className="placeholder">IMAGE</div>
            }
            <span className="multi-modal-tag">llava:7b routed</span>
          </div>
        ))}

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
