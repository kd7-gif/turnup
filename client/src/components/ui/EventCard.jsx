import { Link } from 'react-router-dom';
import { dateParts, dayLabel, priceLabel, timeLabel, whenLabel } from '../../api/client.js';
import { Faces } from './Avatar.jsx';
import SaveButton from './SaveButton.jsx';

export function goingText(e) {
  if (e.friends_count > 0) {
    const [a, b] = e.friends_going;
    const others = e.friends_count - (b ? 2 : 1);
    if (!b) return `${a} is going`;
    return others > 0 ? `${a}, ${b} +${others} friend${others === 1 ? '' : 's'}` : `${a} and ${b} are going`;
  }
  return `${e.going_count} going`;
}

export default function EventCard({ e }) {
  const { day, month } = dateParts(e.starts_at);
  const when = whenLabel(e.starts_at, e.ends_at);
  const price = priceLabel(e);
  return (
    <Link to={`/e/${e.slug}`} className="e-card">
      <div className="e-card-img">
        <img src={e.image_url} alt="" loading="lazy" />
        <span className="date-tile"><b>{day}</b><span>{month}</span></span>
        <span className={`when-pill ${when === 'Happening now' ? 'now' : ''}`}>{when}</span>
        <span className={`e-price ${e.is_free ? 'free' : price === 'Sold out' ? 'out' : ''}`}>{price}</span>
        <SaveButton slug={e.slug} title={e.title} saved={e.saved} />
      </div>
      <div className="e-card-body">
        <p className="e-card-meta">{e.category} · {e.area}, {e.city}</p>
        <h3>{e.title}</h3>
        <p className="e-card-sub">{dayLabel(e.starts_at)} · {timeLabel(e.starts_at)} · {e.venue}</p>
        <div className="e-card-foot">
          <span className={`going ${e.friends_count ? 'friends' : ''}`}>
            {e.friends_count > 0 && <Faces names={e.friends_going} />}
            <span>{goingText(e)}</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
