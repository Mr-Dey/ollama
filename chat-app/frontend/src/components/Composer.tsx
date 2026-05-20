import React, { useRef, useEffect } from 'react';
import { Attachment } from '../types';
import { VISION_MODELS } from '../lib/helpers';
import { IcoPaperclip, IcoMic, IcoSend, IcoX } from '../icons';

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

export default function Composer({
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
