import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  IconAlertTriangle, IconArrowLeft, IconCamera, IconCameraOff, IconCheck, IconKeyboard, IconSearch, IconUsers, IconX,
} from '@tabler/icons-react';
import { api, timeLabel } from '../api/client.js';

const RESULT = {
  admitted: { tone: 'ok', icon: IconCheck, title: (g) => (g.admits > 1 ? `Admit ${g.admits}` : 'Admit') },
  already_used: { tone: 'bad', icon: IconX, title: () => 'Already used' },
  wrong_event: { tone: 'bad', icon: IconAlertTriangle, title: () => 'Wrong event' },
  invalid: { tone: 'warn', icon: IconAlertTriangle, title: () => 'Not a valid ticket' },
};

/** The scanner a door person uses: camera, a big admit/refuse answer, typed codes and a guest list. */
export default function DoorEvent() {
  const { slug } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState('scan');
  const [typed, setTyped] = useState('');
  const busy = useRef(false);
  const lastCode = useRef({ code: '', at: 0 });
  const clearTimer = useRef(null);

  useEffect(() => { api(`/checkin/${slug}`).then(setInfo).catch((e) => setError(e.message)); }, [slug]);

  const scan = useCallback(async (code) => {
    const now = Date.now();
    // The camera sees the same code many times a second: only send it once every few seconds
    if (busy.current || (code === lastCode.current.code && now - lastCode.current.at < 4000)) return;
    busy.current = true;
    lastCode.current = { code, at: now };
    try {
      const r = await api(`/checkin/${slug}/scan`, { method: 'POST', body: { code } });
      setResult(r);
      setInfo((i) => i && { ...i, counts: r.counts });
      navigator.vibrate?.(r.result === 'admitted' ? 80 : [60, 60, 60]);
    } catch (e) {
      setResult({ result: 'invalid', message: e.message });
    } finally {
      busy.current = false;
      clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setResult(null), 3500);
    }
  }, [slug]);

  if (error) return <div className="container empty"><h1>Can’t open this door</h1><p className="muted">{error}</p><Link to="/door" className="btn btn-primary">Back to events</Link></div>;
  if (!info) return <div className="container ev-top"><div className="skeleton" style={{ minHeight: 420 }} /></div>;
  const { event, counts } = info;
  const pct = counts.expected ? Math.round((counts.checked_in / counts.expected) * 100) : 0;
  const R = result && RESULT[result.result];

  return (
    <div className="container ev-top door">
      <Link to="/door" className="back"><IconArrowLeft size={18} aria-hidden="true" /> All events</Link>
      <div className="door-head">
        <div>
          <h1>{event.title}</h1>
          <p className="muted small">{event.venue} · doors from {timeLabel(event.starts_at)}</p>
        </div>
        <div className="door-count" aria-live="polite">
          <strong>{counts.checked_in}</strong><span>of {counts.expected} in</span>
          <div className="meter"><span style={{ width: `${pct}%` }} /></div>
        </div>
      </div>

      <div className="chips" role="tablist" aria-label="Check-in method">
        <button type="button" role="tab" aria-selected={tab === 'scan'} className={`chip ${tab === 'scan' ? 'on' : ''}`} onClick={() => setTab('scan')}><IconCamera size={16} aria-hidden="true" /> Scan</button>
        <button type="button" role="tab" aria-selected={tab === 'type'} className={`chip ${tab === 'type' ? 'on' : ''}`} onClick={() => setTab('type')}><IconKeyboard size={16} aria-hidden="true" /> Type code</button>
        <button type="button" role="tab" aria-selected={tab === 'list'} className={`chip ${tab === 'list' ? 'on' : ''}`} onClick={() => setTab('list')}><IconUsers size={16} aria-hidden="true" /> Guest list</button>
      </div>

      <div className="door-stage">
        {tab === 'scan' && <Camera onCode={scan} paused={Boolean(result)} />}
        {tab === 'type' && (
          <form className="type-code" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { lastCode.current = { code: '', at: 0 }; scan(typed); setTyped(''); } }}>
            <label htmlFor="code">Ticket code</label>
            <input id="code" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="ABCD EFGH JKLM NPQR" autoComplete="off" autoCapitalize="characters" spellCheck="false" />
            <button className="btn btn-primary" type="submit" disabled={!typed.trim()}>Check in</button>
            <p className="faint small">The code is printed under the QR code on every ticket.</p>
          </form>
        )}
        {tab === 'list' && <GuestList slug={slug} onCheckIn={(code) => { lastCode.current = { code: '', at: 0 }; scan(code); }} counts={counts} />}

        {R && (
          <div className={`verdict ${R.tone}`} role="alert" onClick={() => setResult(null)}>
            <span className="verdict-icon"><R.icon size={56} stroke={2.5} aria-hidden="true" /></span>
            <h2>{R.title(result.guest || {})}</h2>
            {result.guest && <p className="verdict-name">{result.guest.name}</p>}
            {result.guest && <p>{result.guest.tier}{result.guest.admits > 1 ? ` · group of ${result.guest.admits}` : ''}</p>}
            {result.result === 'already_used' && <p>Checked in at {timeLabel(result.checked_in_at)}{result.checked_in_by ? ` by ${result.checked_in_by}` : ''}</p>}
            {result.result !== 'admitted' && result.result !== 'already_used' && <p>{result.message}</p>}
            <span className="faint small">Tap to scan the next guest</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Live camera that reports QR codes. Needs https or localhost, and the visitor's permission. */
function Camera({ onCode, paused }) {
  const video = useRef(null);
  const scanner = useRef(null);
  const [state, setState] = useState('starting');

  useEffect(() => {
    let stopped = false;
    import('qr-scanner').then(async ({ default: QrScanner }) => {
      if (stopped) return;
      if (!(await QrScanner.hasCamera())) { setState('none'); return; }
      scanner.current = new QrScanner(video.current, (r) => onCode(r.data), {
        preferredCamera: 'environment', highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 8,
      });
      try { await scanner.current.start(); if (!stopped) setState('on'); } catch { setState('denied'); }
    }).catch(() => setState('none'));
    return () => { stopped = true; scanner.current?.destroy(); scanner.current = null; };
  }, [onCode]);

  useEffect(() => {
    if (!scanner.current || state !== 'on') return;
    if (paused) scanner.current.pause(); else scanner.current.start().catch(() => {});
  }, [paused, state]);

  return (
    <div className="camera">
      <video ref={video} muted playsInline />
      {state !== 'on' && (
        <div className="camera-msg">
          {state === 'starting' ? <><IconCamera size={36} aria-hidden="true" /><p>Starting the camera…</p></>
            : <><IconCameraOff size={36} aria-hidden="true" />
              <p>{state === 'denied' ? 'Allow camera access in your browser to scan tickets.' : 'No camera found on this device.'}</p>
              <p className="small">You can still type codes or use the guest list.</p></>}
        </div>
      )}
    </div>
  );
}

function GuestList({ slug, onCheckIn, counts }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState(null);
  useEffect(() => {
    let stale = false;
    const t = setTimeout(() => api(`/checkin/${slug}/guests?q=${encodeURIComponent(q.trim())}`).then((d) => !stale && setItems(d.items)).catch(() => {}), 200);
    return () => { stale = true; clearTimeout(t); };
  }, [slug, q, counts.checked_in]);
  return (
    <div className="guest-list">
      <div className="search" style={{ marginTop: 0, maxWidth: 'none' }}>
        <IconSearch size={20} aria-hidden="true" />
        <label htmlFor="gq" className="sr-only">Search guests by name or order number</label>
        <input id="gq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or order number" autoComplete="off" />
      </div>
      {!items ? <div className="skeleton" style={{ minHeight: 160 }} /> : items.length === 0 ? <p className="muted">No guests match.</p> : (
        <ul>
          {items.map((g) => (
            <li key={g.code} className={g.status === 'used' ? 'in' : ''}>
              <div>
                <strong>{g.full_name}</strong>
                <span className="muted small">{g.tier_name}{g.admits > 1 ? ` · admits ${g.admits}` : ''} · {g.order_number}</span>
              </div>
              {g.status === 'used'
                ? <span className="tag ok-tag"><IconCheck size={12} aria-hidden="true" /> In {timeLabel(g.checked_in_at)}</span>
                : <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCheckIn(g.code)}>Check in</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
