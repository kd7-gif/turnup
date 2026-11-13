import { useRealtime } from '../../context/RealtimeContext.jsx';

/** Shows whether this page is receiving instant updates. */
export default function LiveBadge({ fallback = 'Reconnecting… refreshing every 30 seconds meanwhile' }) {
  const { connected } = useRealtime();
  return (
    <p className={`live-badge ${connected ? 'on' : ''}`} role="status">
      <span className={connected ? 'live-dot' : 'off-dot'} aria-hidden="true" />
      {connected ? 'Live: updates appear instantly' : fallback}
    </p>
  );
}
