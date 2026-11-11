import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { IconHeart, IconHeartFilled } from '@tabler/icons-react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';

/** Heart that saves an event to the signed-in user's list. Visitors are sent to log in first. */
export default function SaveButton({ slug, title, saved: initial, className = 'save-btn', onChange, withLabel = false }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);

  const toggle = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return navigate('/login', { state: { from: location.pathname } });
    if (busy) return;
    const next = !saved;
    setSaved(next); // show it straight away, undo if the server says no
    setBusy(true);
    try {
      await api(`/events/${slug}/save`, { method: next ? 'POST' : 'DELETE' });
      onChange?.(next);
    } catch {
      setSaved(!next);
    } finally {
      setBusy(false);
    }
  };

  const Icon = saved ? IconHeartFilled : IconHeart;
  return (
    <button type="button" className={`${className} ${saved ? 'on' : ''}`} onClick={toggle} aria-pressed={saved}
      aria-label={saved ? `Remove ${title} from saved` : `Save ${title}`}>
      <Icon size={20} aria-hidden="true" />{withLabel && <span>{saved ? 'Saved' : 'Save'}</span>}
    </button>
  );
}
