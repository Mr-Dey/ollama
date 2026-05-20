import React, { useState, useEffect, useCallback } from 'react';
import { IcoTrash } from '../icons';

export default function AdminView({ token }: { token: string }) {
  const [users, setUsers] = useState<any[]>([]);
  const [adminLoading, setAdminLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user', email: '' });
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  const loadUsers = useCallback(() => {
    setAdminLoading(true);
    fetch(`/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setUsers(data); })
      .catch(() => {})
      .finally(() => setAdminLoading(false));
  }, [token]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    setAddLoading(true);
    try {
      const res = await fetch(`/api/admin/users`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });
      if (!res.ok) {
        const d = await res.json();
        setAddError(d.error || 'Failed to create user');
        return;
      }
      setNewUser({ username: '', password: '', role: 'user', email: '' });
      setShowAddForm(false);
      loadUsers();
    } catch {
      setAddError('Network error');
    } finally {
      setAddLoading(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!window.confirm('Delete this user?')) return;
    await fetch(`/api/admin/users/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    loadUsers();
  };

  return (
    <div className="cluster-view">
      <div className="cluster-head">
        <div>
          <div className="crumb">k3s-cluster / admin</div>
          <h2>User Management</h2>
        </div>
        <button
          onClick={() => setShowAddForm(v => !v)}
          style={{ padding: '8px 14px', background: 'var(--bone)', color: 'var(--bone-ink)', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
        >
          {showAddForm ? 'Cancel' : '+ Add user'}
        </button>
      </div>

      {showAddForm && (
        <div style={{ maxWidth: 1180, margin: '0 auto 24px', padding: 20, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--bg-elev)' }}>
          <form onSubmit={handleAddUser} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {[
              { label: 'Username', key: 'username', type: 'text', placeholder: 'username' },
              { label: 'Password', key: 'password', type: 'password', placeholder: '••••••••' },
              { label: 'Email', key: 'email', type: 'email', placeholder: 'user@example.com' },
            ].map(f => (
              <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{f.label}</div>
                <input
                  type={f.type}
                  placeholder={f.placeholder}
                  value={(newUser as any)[f.key]}
                  onChange={e => setNewUser(u => ({ ...u, [f.key]: e.target.value }))}
                  required={f.key !== 'email'}
                  style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 12px', color: 'var(--ink)', fontSize: 13, fontFamily: 'var(--font-sans)', outline: 'none' }}
                />
              </div>
            ))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Role</div>
              <select
                value={newUser.role}
                onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))}
                style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 12px', color: 'var(--ink)', fontSize: 13, fontFamily: 'var(--font-mono)', outline: 'none' }}
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>
            {addError && <div style={{ color: '#f87171', fontSize: 13, width: '100%' }}>{addError}</div>}
            <button
              type="submit"
              disabled={addLoading}
              style={{ padding: '8px 16px', background: 'var(--bone)', color: 'var(--bone-ink)', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)', opacity: addLoading ? 0.6 : 1 }}
            >
              {addLoading ? 'Creating…' : 'Create user'}
            </button>
          </form>
        </div>
      )}

      {adminLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          Loading users…
        </div>
      ) : (
        <div className="pod-table-wrap">
          <table className="pod-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Email</th>
                <th>Created</th>
                <th>Last Login</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u._id || u.id}>
                  <td className="pod-name">{u.username}</td>
                  <td>
                    <span className={`badge${u.role === 'admin' ? '' : ' warn'}`} style={u.role === 'admin' ? { borderColor: 'rgba(239,231,215,0.32)', background: 'rgba(239,231,215,0.08)', color: 'var(--bone)' } : {}}>
                      <span className="dot" />
                      {u.role}
                    </span>
                  </td>
                  <td>{u.email ?? '—'}</td>
                  <td className="age">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
                  <td className="age">{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : '—'}</td>
                  <td>
                    <button
                      onClick={() => handleDeleteUser(u._id || u.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', padding: '4px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontFamily: 'var(--font-mono)' }}
                      title="Delete user"
                    >
                      <IcoTrash />
                      delete
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-4)', padding: 32 }}>No users found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
