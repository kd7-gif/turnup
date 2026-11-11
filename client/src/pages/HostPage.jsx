import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { IconArrowLeft, IconCircleCheckFilled } from '@tabler/icons-react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import EventCard from '../components/ui/EventCard.jsx';

export default function HostPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setData(null);
    api(`/hosts/${slug}`).then(setData).catch((e) => setError(e.message));
  }, [slug, user]);

  if (error) return <div className="container empty"><h1>Host not found</h1><p className="muted">{error}</p><Link to="/" className="btn btn-primary">Back to events</Link></div>;
  if (!data) return <div className="container ev-top"><div className="skeleton" style={{ minHeight: 320 }} /></div>;
  const { host, events } = data;

  const follow = async () => {
    if (!user) return navigate('/login', { state: { from: location.pathname } });
    setBusy(true);
    try {
      const r = await api(`/hosts/${host.slug}/follow`, { method: host.following ? 'DELETE' : 'POST' });
      setData({ ...data, host: { ...host, following: r.following, followers: host.followers + (r.following ? 1 : -1) } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container ev-top">
      <Link to="/" className="back"><IconArrowLeft size={18} aria-hidden="true" /> All events</Link>
      <div className="host-hero">{host.image_url && <img src={host.image_url} alt="" />}</div>
      <div className="host-head">
        {host.image_url && <img className="host-logo" src={host.image_url} alt="" />}
        <div className="host-head-text">
          <h1>{host.name} {host.verified && <IconCircleCheckFilled size={26} className="verified" aria-label="Verified host" />}</h1>
          <div className="host-stats">
            <span><strong>{host.followers}</strong> followers</span>
            <span><strong>{host.events_hosted}</strong> events</span>
          </div>
        </div>
        <button type="button" className={`btn ${host.following ? 'btn-ghost' : 'btn-primary'}`} onClick={follow} disabled={busy} aria-pressed={host.following}>
          {host.following ? 'Following' : 'Follow'}
        </button>
      </div>
      <p className="host-bio">{host.bio}</p>

      <section className="row-section">
        <div className="row-head"><h2>Upcoming events</h2><span className="muted">{events.length}</span></div>
        {events.length ? <div className="grid">{events.map((e) => <EventCard key={e.id} e={e} />)}</div>
          : <p className="muted">No upcoming events right now. Follow to hear about the next one.</p>}
      </section>
    </div>
  );
}
