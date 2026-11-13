import { useEffect, useState } from 'react';
import { IconLayoutDashboard, IconRefresh, IconScan, IconUser } from '@tabler/icons-react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';

const ROLES = [
  { role: 'guest', label: 'Guest', icon: IconUser, home: '/' },
  { role: 'host', label: 'Host', icon: IconLayoutDashboard, home: '/host' },
  { role: 'door', label: 'Door', icon: IconScan, home: '/door' },
];
const TIPS = {
  guest: 'Buy a ticket (try code AFTERDARK on Neon Nights), then switch to Door to scan it.',
  host: 'Open an event and press Live check-in, then simulate the doors opening.',
  door: 'Pick an event, then type a ticket code from My tickets or scan its QR code.',
};

/** Shown only on the hosted demo: switch between guest, host and door staff in one tap. */
export default function DemoBar() {
  const { user } = useAuth();
  const [busy, setBusy] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const current = user?.email === 'host@turnup.demo' ? 'host' : user?.email === 'door@turnup.demo' ? 'door' : user ? 'guest' : null;

  useEffect(() => {
    let off = () => {};
    import('../../demo/server.js').then(({ demoSocket }) => {
      const reload = () => window.location.assign('/');
      demoSocket.on('demo:reset', reload);
      off = () => demoSocket.off('demo:reset', reload);
    });
    return () => off();
  }, []);

  const switchTo = async (r) => {
    setBusy(r.role);
    await api('/demo/switch', { method: 'POST', body: { role: r.role } });
    window.location.assign(r.home); // reload so every page starts fresh as the new account
  };
  const reset = async () => {
    if (!confirmReset) { setConfirmReset(true); return; }
    const { resetDemo } = await import('../../demo/server.js');
    resetDemo();
    window.location.assign('/');
  };

  return (
    <div className="demo-bar" role="region" aria-label="Demo controls">
      <div className="container demo-bar-inner">
        <p className="demo-bar-text"><strong>Live demo</strong><span className="demo-tip">{TIPS[current] || 'Everything runs in your browser. Pick who you want to be.'}</span></p>
        <div className="demo-switch" role="group" aria-label="View as">
          {ROLES.map((r) => (
            <button key={r.role} type="button" className={current === r.role ? 'on' : ''} aria-pressed={current === r.role} disabled={Boolean(busy)} onClick={() => switchTo(r)}>
              <r.icon size={16} aria-hidden="true" /> {busy === r.role ? '…' : r.label}
            </button>
          ))}
        </div>
        <button type="button" className="demo-reset" onClick={reset} onBlur={() => setConfirmReset(false)} aria-label={confirmReset ? 'Tap again to reset the demo' : 'Reset the demo'}>
          <IconRefresh size={16} aria-hidden="true" /> <span className={confirmReset ? '' : 'demo-reset-label'}>{confirmReset ? 'Tap again' : 'Reset'}</span>
        </button>
      </div>
    </div>
  );
}
