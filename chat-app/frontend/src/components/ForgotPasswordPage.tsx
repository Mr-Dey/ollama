import React, { useState, useRef, useEffect } from 'react';
import { pwStrength } from '../lib/helpers';

export default function ForgotPasswordPage({ onBack }: { onBack: () => void }) {
  const [step, setStep]             = useState<1 | 2 | 3 | 4>(1);
  const [email, setEmail]           = useState('');
  const [otp, setOtp]               = useState(['', '', '', '', '', '']);
  const [resetToken, setResetToken] = useState('');
  const [newPw, setNewPw]           = useState('');
  const [confirmPw, setConfirmPw]   = useState('');
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [countdown, setCountdown]   = useState(0);
  const [devCode, setDevCode]       = useState('');
  const [devHint, setDevHint]       = useState('');
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const sendOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email.trim()) { setError('Enter your email address'); return; }
    setError(''); setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Failed to send code'); return; }
      if (d.devMode && d.devCode) {
        setDevCode(d.devCode);
        setDevHint(d.hint || 'SMTP is not configured. The OTP is shown here for testing.');
      } else {
        setDevCode('');
        setDevHint('');
      }
      setStep(2);
      setCountdown(60);
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  };

  const handleOtpKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) {
      otpRefs.current[i - 1]?.focus();
    }
  };

  const handleOtpChange = (i: number, val: string) => {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[i] = digit;
    setOtp(next);
    if (digit && i < 5) otpRefs.current[i + 1]?.focus();
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (text.length === 6) {
      setOtp(text.split(''));
      otpRefs.current[5]?.focus();
    }
    e.preventDefault();
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otp.join('');
    if (code.length < 6) { setError('Enter the full 6-digit code'); return; }
    setError(''); setLoading(true);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Invalid code'); return; }
      setResetToken(d.resetToken);
      setStep(3);
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  };

  const resetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (newPw !== confirmPw) { setError('Passwords do not match'); return; }
    setError(''); setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetToken, password: newPw }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Reset failed'); return; }
      setStep(4);
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  };

  const strength = pwStrength(newPw);

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="glyph">Λ</div>
          <h2>Reset password</h2>
          <p>
            {step === 1 && 'Enter your account email'}
            {step === 2 && 'Enter the 6-digit code'}
            {step === 3 && 'Set a new password'}
            {step === 4 && 'Password updated'}
          </p>
        </div>

        <div className="step-dots">
          {[1, 2, 3].map(s => (
            <div key={s} className={`step-dot${step === s ? ' active' : step > s ? ' done' : ''}`} />
          ))}
        </div>

        {step === 1 && (
          <form onSubmit={sendOtp} className="login-form">
            <div className="field">
              <div className="label">Email address</div>
              <input
                className="login-input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus required
              />
            </div>
            {error && <div className="login-error">{error}</div>}
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Sending…' : 'Send code →'}
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={verifyOtp} className="login-form">
            {devCode && (
              <div className="dev-otp-banner">
                <div className="dev-otp-label">DEV MODE — SMTP not configured</div>
                <div className="dev-otp-code">{devCode}</div>
                <div className="dev-otp-hint">{devHint}</div>
                <button type="button" className="dev-otp-fill" onClick={() => {
                  setOtp(devCode.split(''));
                  setTimeout(() => otpRefs.current[5]?.focus(), 0);
                }}>
                  Auto-fill →
                </button>
              </div>
            )}
            <div className="field">
              <div className="label" style={{ textAlign: 'center', marginBottom: 12 }}>
                Code sent to <span style={{ color: 'var(--ink-2)' }}>{email}</span>
              </div>
              <div className="otp-boxes" onPaste={handleOtpPaste}>
                {otp.map((d, i) => (
                  <input
                    key={i}
                    ref={el => { otpRefs.current[i] = el; }}
                    className={`otp-box${d ? ' filled' : ''}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    onChange={e => handleOtpChange(i, e.target.value)}
                    onKeyDown={e => handleOtpKey(i, e)}
                    autoFocus={i === 0}
                  />
                ))}
              </div>
            </div>
            {error && <div className="login-error">{error}</div>}
            <button type="submit" className="login-btn" disabled={loading || otp.join('').length < 6}>
              {loading ? 'Verifying…' : 'Verify code →'}
            </button>
            <div className="resend-row">
              {countdown > 0
                ? <><span>Resend in</span><span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{countdown}s</span></>
                : <><span>Didn't get it?</span><button type="button" onClick={sendOtp}>Resend code</button></>
              }
            </div>
          </form>
        )}

        {step === 3 && (
          <form onSubmit={resetPassword} className="login-form">
            <div className="field">
              <div className="label">New password</div>
              <input
                className="login-input"
                type="password"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                placeholder="Min 6 characters"
                autoFocus required
              />
              {newPw && (
                <div className="pw-strength">
                  <div className="pw-strength-bar" style={{ width: `${(strength.score / 4) * 100}%`, background: strength.color }} />
                </div>
              )}
              {newPw && strength.label && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: strength.color, marginTop: 4 }}>{strength.label}</div>
              )}
            </div>
            <div className="field">
              <div className="label">Confirm password</div>
              <input
                className="login-input"
                type="password"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                placeholder="Repeat password"
                required
              />
              {confirmPw && newPw !== confirmPw && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#f08570', marginTop: 4 }}>Passwords don't match</div>
              )}
            </div>
            {error && <div className="login-error">{error}</div>}
            <button type="submit" className="login-btn" disabled={loading || newPw !== confirmPw || newPw.length < 6}>
              {loading ? 'Resetting…' : 'Reset password →'}
            </button>
          </form>
        )}

        {step === 4 && (
          <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
            <div className="success-icon">✓</div>
            <p style={{ fontSize: 14, color: 'var(--ink-2)', margin: '0 0 20px', lineHeight: 1.6 }}>
              Your password has been reset successfully.<br />You can now sign in with your new password.
            </p>
            <button className="login-btn" onClick={onBack}>Back to sign in →</button>
          </div>
        )}

        {step !== 4 && (
          <div className="back-link">
            <button type="button" onClick={onBack}>← Back to sign in</button>
          </div>
        )}
      </div>
    </div>
  );
}
