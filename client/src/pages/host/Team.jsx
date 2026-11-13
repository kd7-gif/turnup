import { useEffect, useState } from 'react';
import { IconTrash } from '@tabler/icons-react';
import { api } from '../../api/client.js';

export default function Team({ host }) {
  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('door');
  const [msg, setMsg] = useState({ text: '', bad: false });
  const load = () => api(`/host/${host.slug}/team`).then(setData).catch(() => setData({ items: [], can_edit: false }));
  useEffect(() => { load(); }, [host.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (e) => {
    e.preventDefault();
    try {
      const r = await api(`/host/${host.slug}/team`, { method: 'POST', body: { email, role } });
      setMsg({ text: `${r.name} added as ${r.role === 'cohost' ? 'a co-host' : 'door staff'}.`, bad: false });
      setEmail('');
      load();
    } catch (err) { setMsg({ text: err.message, bad: true }); }
  };
  const remove = async (u) => { await api(`/host/${host.slug}/team/${u.id}`, { method: 'DELETE' }); load(); };

  return (
    <div className="dash-grid">
      <section>
        {!data ? <div className="skeleton" style={{ minHeight: 160 }} /> : data.items.length === 0 ? <p className="muted">Just you so far.</p> : (
          <ul className="feed team">
            {data.items.map((u) => (
              <li key={u.id}>
                <div><strong>{u.full_name}</strong><span className="muted small">{u.email}</span></div>
                <span className={`pill ${u.role === 'cohost' ? 'live' : 'draft'}`}>{u.role === 'cohost' ? 'Co-host' : 'Door'}</span>
                {data.can_edit && <button type="button" className="icon-btn" aria-label={`Remove ${u.full_name}`} onClick={() => remove(u)}><IconTrash size={18} /></button>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <aside className="panel">
        <h2>Add someone</h2>
        <p className="muted small"><strong>Door staff</strong> can only check guests in. <strong>Co-hosts</strong> can also create and edit events, ticket types and promo codes.</p>
        {data?.can_edit ? (
          <form className="auth-form compact" onSubmit={add} noValidate>
            <div className="field"><label htmlFor="tm-email">Their Turnup email</label><input id="tm-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></div>
            <div className="field"><label htmlFor="tm-role">Role</label>
              <select id="tm-role" value={role} onChange={(e) => setRole(e.target.value)}><option value="door">Door staff</option><option value="cohost">Co-host</option></select></div>
            {msg.text && <p className={`notice ${msg.bad ? 'error' : 'info'}`} role="status">{msg.text}</p>}
            <button className="btn btn-primary" type="submit" disabled={!email.trim()}>Add to team</button>
          </form>
        ) : <p className="notice info small">Only the owner can change the team.</p>}
      </aside>
    </div>
  );
}
