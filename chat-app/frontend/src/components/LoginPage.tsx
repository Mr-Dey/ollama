import React from 'react';

interface LoginPageProps {
  form: { username: string; password: string };
  onChange: (f: { username: string; password: string }) => void;
  onSubmit: (e: React.FormEvent) => void;
  error: string;
  loading: boolean;
  onForgotPassword: () => void;
}

export default function LoginPage({ form, onChange, onSubmit, error, loading, onForgotPassword }: LoginPageProps) {
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
            <div className="label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Password</span>
              <button
                type="button"
                onClick={onForgotPassword}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', textDecoration: 'underline', letterSpacing: '0.04em' }}
              >
                Forgot password?
              </button>
            </div>
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
