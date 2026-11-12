import { Link } from 'react-router-dom';
import { IconCalendarEvent, IconMapPin, IconUsers } from '@tabler/icons-react';
import { dayLabel, timeLabel } from '../../api/client.js';
import TicketQR from './TicketQR.jsx';

/** One ticket, styled like a festival pass: event on the left, QR code on the tear-off stub. */
export default function TicketPass({ event, ticket, index, total }) {
  const used = ticket.status === 'used';
  return (
    <article className={`pass ${used ? 'used' : ''}`} aria-label={`${ticket.tier_name} ticket for ${event.title}`}>
      <div className="pass-main">
        <img src={event.image_url} alt="" className="pass-img" />
        <div className="pass-info">
          <p className="pass-tier">{ticket.tier_name}{total > 1 ? ` · ${index + 1} of ${total}` : ''}</p>
          <Link to={`/e/${event.slug}`} className="pass-title">{event.title}</Link>
          <p><IconCalendarEvent size={16} aria-hidden="true" /> {dayLabel(event.starts_at)} · {timeLabel(event.starts_at)}</p>
          <p><IconMapPin size={16} aria-hidden="true" /> {event.venue}, {event.area}</p>
          {ticket.admits > 1 && <p className="pass-admits"><IconUsers size={16} aria-hidden="true" /> Admits {ticket.admits} people</p>}
        </div>
      </div>
      <div className="pass-stub">
        <TicketQR code={ticket.code} size={132} />
        <code className="pass-code">{ticket.code.match(/.{1,4}/g).join(' ')}</code>
        {used && <span className="pass-used">Checked in</span>}
      </div>
    </article>
  );
}
