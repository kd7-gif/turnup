import { useEffect, useState } from 'react';
import { api, dayLabel, naira } from '../../api/client.js';

export default function PromoCodes({ host, events }) {
  const [items, setItems] = useState(null);
  const [form, setForm] = useState({ code: '', kind: 'percent', value: '', max_uses: '', expires_at: '', event_slug: '' });
  const [fields, setFields] = useState({});
  const [msg, setMsg] = useState('');
  const load = () => api(`/host/${host.slug}/promos`).then((d) => setItems(d.items)).catch(() => setItems([]));
  useEffect(() => { load(); }, [host.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setFields({ ...fields, [k]: undefined }); };
  const create = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await api(`/host/${host.slug}/promos`, { method: 'POST', body: { ...form, value: Number(form.value), max_uses: form.max_uses === '' ? null : Number(form.max_uses) } });
      setForm({ code: '', kind: 'percent', value: '', max_uses: '', expires_at: '', event_slug: '' });
      setMsg(`${form.code.toUpperCase()} is ready to use.`);
      load();
    } catch (err) { setFields(err.fields || {}); setMsg(err.message); }
  };
  const toggle = async (p) => {
    await api(`/host/${host.slug}/promos/${p.id}`, { method: 'PATCH', body: { active: !p.active } });
    load();
  };
  const err = (k) => fields[k] && <span className="error">{fields[k]}</span>;

  return (
    <div className="dash-grid">
      <section>
        {!items ? <div className="skeleton" style={{ minHeight: 200 }} /> : items.length === 0 ? <p className="muted">No promo codes yet.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Code</th><th>Discount</th><th>For</th><th>Used</th><th>Ends</th><th>On</th></tr></thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className={p.active ? '' : 'off'}>
                    <td><code>{p.code}</code></td>
                    <td>{p.kind === 'percent' ? `${p.value}% off` : `${naira(p.value)} off`}</td>
                    <td>{p.event_title || 'All events'}</td>
                    <td>{p.used}{p.max_uses ? ` / ${p.max_uses}` : ''}</td>
                    <td>{p.expires_at ? dayLabel(p.expires_at) : 'Never'}</td>
                    <td><button type="button" className={`toggle ${p.active ? 'on' : ''}`} aria-pressed={p.active} aria-label={`${p.code} ${p.active ? 'on' : 'off'}`} onClick={() => toggle(p)}><span /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <aside className="panel">
        <h2>New promo code</h2>
        <form className="auth-form compact" onSubmit={create} noValidate>
          <div className="field"><label htmlFor="pc-code">Code</label><input id="pc-code" value={form.code} onChange={set('code')} placeholder="EARLYBIRD" style={{ textTransform: 'uppercase' }} />{err('code')}</div>
          <div className="field-row">
            <div className="field"><label htmlFor="pc-kind">Type</label>
              <select id="pc-kind" value={form.kind} onChange={set('kind')}><option value="percent">Percent off</option><option value="amount">Naira off</option></select></div>
            <div className="field"><label htmlFor="pc-value">{form.kind === 'percent' ? 'Percent' : 'Amount (₦)'}</label><input id="pc-value" inputMode="numeric" value={form.value} onChange={set('value')} placeholder={form.kind === 'percent' ? '10' : '2000'} />{err('value')}</div>
          </div>
          <div className="field"><label htmlFor="pc-event">Works on</label>
            <select id="pc-event" value={form.event_slug} onChange={set('event_slug')}>
              <option value="">All my events</option>
              {events.filter((e) => !e.past && e.status !== 'cancelled').map((e) => <option key={e.slug} value={e.slug}>{e.title}</option>)}
            </select></div>
          <div className="field-row">
            <div className="field"><label htmlFor="pc-max">Uses (optional)</label><input id="pc-max" inputMode="numeric" value={form.max_uses} onChange={set('max_uses')} placeholder="Unlimited" />{err('max_uses')}</div>
            <div className="field"><label htmlFor="pc-exp">Ends (optional)</label><input id="pc-exp" type="datetime-local" value={form.expires_at} onChange={set('expires_at')} />{err('expires_at')}</div>
          </div>
          {msg && <p className={`notice ${Object.keys(fields).length ? 'error' : 'info'}`} role="status">{msg}</p>}
          <button className="btn btn-primary" type="submit">Create code</button>
        </form>
      </aside>
    </div>
  );
}
