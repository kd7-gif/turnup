import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { IconArrowLeft, IconPlus, IconTrash } from '@tabler/icons-react';
import { api, toLagosInput } from '../../api/client.js';

const blankTier = () => ({ name: '', price: '', quantity: '', admits: 1, max_per_order: 10, description: '', sales_end: '' });
const nextSaturday = () => {
  const d = new Date(Date.now() + 3600000);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
};

/** Create an event (with ticket types) or edit an existing event's details. */
export default function EventEditor() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const editing = Boolean(slug);
  const [opts, setOpts] = useState(null);
  const [form, setForm] = useState(null);
  const [tiers, setTiers] = useState([{ ...blankTier(), name: 'Regular' }]);
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/host/options').then(setOpts).catch((e) => setError(e.message));
    if (editing) {
      api(`/host/events/${slug}`).then(({ event: e }) => setForm({
        title: e.title, category: e.category, summary: e.summary, description: e.description, venue: e.venue, area: e.area, city: e.city,
        image_url: e.image_url, starts_at: toLagosInput(e.starts_at), ends_at: toLagosInput(e.ends_at), status: e.status,
      })).catch((e) => setError(e.message));
    } else {
      const day = nextSaturday();
      setForm({ title: '', category: 'Parties', summary: '', description: '', venue: '', area: '', city: 'Lagos', image_url: '',
        starts_at: `${day}T20:00`, ends_at: `${day}T23:59` });
    }
  }, [slug, editing]);

  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setFields({ ...fields, [k]: undefined }); };
  const setTier = (i, k) => (e) => { const t = [...tiers]; t[i] = { ...t[i], [k]: e.target.value }; setTiers(t); setFields({ ...fields, [`tiers.${i}.${k}`]: undefined }); };

  const save = async (publish) => {
    setBusy(true);
    setError('');
    try {
      if (editing) {
        const { status, ...details } = form;
        await api(`/host/events/${slug}`, { method: 'PATCH', body: details });
        navigate(`/host/e/${slug}`);
      } else {
        const body = { ...form, host_slug: params.get('host') || undefined, publish,
          tiers: tiers.map((t) => ({ ...t, price: Number(t.price || 0), quantity: Number(t.quantity), admits: Number(t.admits), max_per_order: Number(t.max_per_order), sales_end: t.sales_end || undefined })) };
        if (!body.host_slug) { const ov = await api('/host/overview'); body.host_slug = ov.host.slug; }
        const r = await api('/host/events', { method: 'POST', body });
        navigate(`/host/e/${r.slug}`);
      }
    } catch (err) {
      setFields(err.fields || {});
      setError(err.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally { setBusy(false); }
  };

  if (error && !form) return <div className="container empty"><h1>Can’t open the editor</h1><p className="muted">{error}</p></div>;
  if (!form || !opts) return <div className="container ev-top"><div className="skeleton" style={{ minHeight: 420 }} /></div>;
  const f = (k, label, input, hint) => (
    <div className="field">
      <label htmlFor={`ev-${k}`}>{label}</label>
      {input}
      {hint && !fields[k] && <span className="faint small">{hint}</span>}
      {fields[k] && <span className="error" id={`ev-${k}-err`}>{fields[k]}</span>}
    </div>
  );
  const inp = (k, props = {}) => <input id={`ev-${k}`} value={form[k]} onChange={set(k)} aria-invalid={fields[k] ? 'true' : 'false'} {...props} />;

  return (
    <div className="container ev-top editor">
      <Link to={editing ? `/host/e/${slug}` : '/host'} className="back"><IconArrowLeft size={18} aria-hidden="true" /> {editing ? 'Back to event' : 'Dashboard'}</Link>
      <h1 className="ev-title" style={{ fontSize: 'clamp(30px, 4.5vw, 44px)', marginTop: 10 }}>{editing ? 'Edit event' : 'Create an event'}</h1>
      {error && <p className="notice error" role="alert" style={{ marginTop: 16 }}>{error}</p>}

      <div className="editor-grid">
        <div className="editor-main">
          <section className="panel">
            <h2>The basics</h2>
            {f('title', 'Event name', inp('title', { placeholder: 'Rooftop Afrobeats Night', maxLength: 140 }))}
            <div className="field-row">
              {f('category', 'Category', <select id="ev-category" value={form.category} onChange={set('category')}>{opts.categories.map((c) => <option key={c}>{c}</option>)}</select>)}
              {f('city', 'City', <select id="ev-city" value={form.city} onChange={set('city')}>{opts.cities.map((c) => <option key={c}>{c}</option>)}</select>)}
            </div>
            {f('summary', 'One-line summary', inp('summary', { placeholder: 'Three DJs, one rooftop, all night', maxLength: 200 }), 'Shown on event cards.')}
            {f('description', 'Description', <textarea id="ev-description" rows={6} value={form.description} onChange={set('description')} aria-invalid={fields.description ? 'true' : 'false'} placeholder="What to expect, line-up, dress code, what is included…" />)}
          </section>

          <section className="panel">
            <h2>When and where</h2>
            <div className="field-row">
              {f('starts_at', 'Starts', inp('starts_at', { type: 'datetime-local' }))}
              {f('ends_at', 'Ends', inp('ends_at', { type: 'datetime-local' }))}
            </div>
            <p className="faint small" style={{ marginTop: -6 }}>Times are in Lagos time (WAT).</p>
            <div className="field-row">
              {f('venue', 'Venue', inp('venue', { placeholder: 'Skyline Rooftop' }))}
              {f('area', 'Area', inp('area', { placeholder: 'Ikoyi' }))}
            </div>
          </section>

          {!editing && (
            <section className="panel">
              <h2>Tickets</h2>
              {fields.tiers && <p className="error">{fields.tiers}</p>}
              {tiers.map((t, i) => (
                <fieldset key={i} className="tier-edit">
                  <legend className="sr-only">Ticket type {i + 1}</legend>
                  <div className="field-row three">
                    {[['name', 'Name', { placeholder: 'Regular' }], ['price', 'Price (₦)', { inputMode: 'numeric', placeholder: '0 for free' }], ['quantity', 'How many', { inputMode: 'numeric', placeholder: '200' }]].map(([k, label, props]) => (
                      <div className="field" key={k}>
                        <label htmlFor={`t${i}-${k}`}>{label}</label>
                        <input id={`t${i}-${k}`} value={t[k]} onChange={setTier(i, k)} aria-invalid={fields[`tiers.${i}.${k}`] ? 'true' : 'false'} {...props} />
                        {fields[`tiers.${i}.${k}`] && <span className="error">{fields[`tiers.${i}.${k}`]}</span>}
                      </div>
                    ))}
                  </div>
                  <div className="field-row three">
                    <div className="field"><label htmlFor={`t${i}-admits`}>People per ticket</label><input id={`t${i}-admits`} inputMode="numeric" value={t.admits} onChange={setTier(i, 'admits')} /></div>
                    <div className="field"><label htmlFor={`t${i}-max`}>Max per order</label><input id={`t${i}-max`} inputMode="numeric" value={t.max_per_order} onChange={setTier(i, 'max_per_order')} /></div>
                    <div className="field"><label htmlFor={`t${i}-end`}>Sales end (early bird)</label><input id={`t${i}-end`} type="datetime-local" value={t.sales_end} onChange={setTier(i, 'sales_end')} /></div>
                  </div>
                  <div className="field"><label htmlFor={`t${i}-desc`}>Description (optional)</label><input id={`t${i}-desc`} value={t.description} onChange={setTier(i, 'description')} placeholder="What this ticket includes" /></div>
                  {tiers.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}><IconTrash size={16} aria-hidden="true" /> Remove</button>}
                </fieldset>
              ))}
              {tiers.length < 10 && <button type="button" className="btn btn-ghost" onClick={() => setTiers([...tiers, blankTier()])}><IconPlus size={18} aria-hidden="true" /> Add ticket type</button>}
            </section>
          )}
        </div>

        <aside className="editor-side">
          <section className="panel">
            <h2>Cover photo</h2>
            {fields.image_url && <p className="error">{fields.image_url}</p>}
            <div className="photo-grid" role="radiogroup" aria-label="Cover photo">
              {opts.photos.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={form.image_url === p} className={form.image_url === p ? 'on' : ''}
                  onClick={() => { setForm({ ...form, image_url: p }); setFields({ ...fields, image_url: undefined }); }}>
                  <img src={p} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </section>
          <div className="editor-actions">
            {editing ? (
              <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => save(false)} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
            ) : (
              <>
                <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => save(true)} disabled={busy}>{busy ? 'Saving…' : 'Publish event'}</button>
                <button type="button" className="btn btn-ghost btn-block" onClick={() => save(false)} disabled={busy}>Save as draft</button>
                <p className="faint small center">Drafts are only visible to you and your co-hosts.</p>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
