import React from 'react';
import { Settings } from '../types';
import { IcoX } from '../icons';

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

export default function SettingsDrawer({
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
