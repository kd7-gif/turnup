import { useEffect, useMemo, useState } from 'react';
import { IconSearch } from '@tabler/icons-react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { categoryOf, ORDER } from '../components/ui/categories.js';
import EventCard from '../components/ui/EventCard.jsx';

const WHEN = [
  { value: '', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'weekend', label: 'This weekend' },
  { value: 'week', label: 'Next 7 days' },
];

export default function Home() {
  const { user } = useAuth();
  const [filters, setFilters] = useState({ cities: [], categories: [] });
  const [city, setCity] = useState('');
  const [category, setCategory] = useState('');
  const [when, setWhen] = useState('');
  const [free, setFree] = useState(false);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ loading: true, items: [], error: '' });
  const [weekend, setWeekend] = useState([]);

  useEffect(() => { api('/events/filters').then(setFilters).catch(() => {}); }, []);
  useEffect(() => { if (user?.city) setCity((c) => c || user.city); }, [user]);

  // Search once the user stops typing
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (city) params.set('city', city);
    if (category) params.set('category', category);
    if (when) params.set('when', when);
    if (free) params.set('free', '1');
    if (query) params.set('q', query);
    let stale = false; // ignore answers that arrive after the filters changed again
    setState((s) => ({ ...s, loading: true, error: '' }));
    api(`/events?${params}`)
      .then((d) => !stale && setState({ loading: false, items: d.items, error: '' }))
      .catch((e) => !stale && setState({ loading: false, items: [], error: e.message }));
    return () => { stale = true; };
  }, [city, category, when, free, query, user]);

  // The weekend row on the browse view
  useEffect(() => {
    let stale = false;
    api(`/events?when=weekend${city ? `&city=${encodeURIComponent(city)}` : ''}`)
      .then((d) => !stale && setWeekend(d.items)).catch(() => !stale && setWeekend([]));
    return () => { stale = true; };
  }, [city, user]);

  const browsing = !category && !when && !free && !query;
  const withFriends = useMemo(() => state.items.filter((e) => e.friends_count > 0)
    .sort((a, b) => b.friends_count - a.friends_count).slice(0, 10), [state.items]);
  const popular = useMemo(() => [...state.items].sort((a, b) => b.going_count - a.going_count).slice(0, 10), [state.items]);
  const freeOnes = useMemo(() => state.items.filter((e) => e.is_free), [state.items]);
  const clear = () => { setQ(''); setCategory(''); setWhen(''); setFree(false); };
  const cats = [...filters.categories].sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category));

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <p className="eyebrow">{city ? `Happening in ${city}` : 'Lagos · Abuja · Ibadan'}</p>
            <h1>What’s the <mark>move</mark> this weekend?</h1>
            <p className="hero-sub">Concerts, parties, food festivals and everything in between. Get tickets in seconds and see where your friends are going.</p>
            <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
              <IconSearch size={20} aria-hidden="true" />
              <label htmlFor="search" className="sr-only">Search events, venues or hosts</label>
              <input id="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Afrobeats, brunch, comedy…" autoComplete="off" />
              <select aria-label="City" value={city} onChange={(e) => setCity(e.target.value)}>
                <option value="">All cities</option>
                {filters.cities.map((c) => <option key={c.city} value={c.city}>{c.city}</option>)}
              </select>
            </form>
            <div className="chips" role="group" aria-label="When">
              {WHEN.map((w) => (
                <button key={w.value || 'any'} type="button" className={`chip ${when === w.value ? 'on' : ''}`} aria-pressed={when === w.value}
                  onClick={() => setWhen(w.value)}>{w.label}</button>
              ))}
              <button type="button" className={`chip ${free ? 'on' : ''}`} aria-pressed={free} onClick={() => setFree(!free)}>Free</button>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <img className="ha-a" src="/img/events/17718209.webp" alt="" />
            <img className="ha-b" src="/img/events/27433139.webp" alt="" />
            <img className="ha-c" src="/img/events/9630128.webp" alt="" />
            <span className="ha-sticker">12 friends are going</span>
          </div>
        </div>
      </section>

      <div className="container">
        <nav className="cats" aria-label="Browse by category">
          {cats.map(({ category: name }) => {
            const { icon: Icon, bg, fg } = categoryOf(name);
            const on = category === name;
            return (
              <button key={name} type="button" className={`cat ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setCategory(on ? '' : name)}>
                <span className="cat-icon" style={{ background: bg, color: fg }}><Icon size={20} aria-hidden="true" /></span>
                {name}
              </button>
            );
          })}
        </nav>

        {state.error && <p className="notice error" role="alert">{state.error}</p>}

        {state.loading && !state.items.length ? (
          <section className="row-section"><div className="grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" />)}</div></section>
        ) : state.items.length === 0 && !state.error ? (
          <div className="empty">
            <h2>Nothing matches yet</h2>
            <p className="muted">Try another search, a different date or another city.</p>
            <button type="button" className="btn btn-ghost" onClick={clear}>Clear filters</button>
          </div>
        ) : browsing ? (
          <>
            {withFriends.length > 0 && <Row title="Your friends are going" items={withFriends} />}
            {weekend.length > 0 && <Row title="This weekend" items={weekend} action={() => setWhen('weekend')} />}
            <Row title="Popular right now" items={popular} />
            {freeOnes.length > 0 && <Row title="Free to attend" items={freeOnes} action={() => setFree(true)} />}
            <section className="row-section">
              <div className="row-head"><h2>All upcoming</h2><span className="muted">{state.items.length} events</span></div>
              <div className="grid">{state.items.map((e) => <EventCard key={e.id} e={e} />)}</div>
            </section>
          </>
        ) : (
          <section className="row-section">
            <div className="row-head">
              <h2>{query ? `Results for “${query}”` : category || WHEN.find((w) => w.value === when)?.label || 'Free events'}</h2>
              <button type="button" className="link-btn" onClick={clear}>Clear</button>
            </div>
            <div className="grid">{state.items.map((e) => <EventCard key={e.id} e={e} />)}</div>
          </section>
        )}
      </div>
    </>
  );
}

function Row({ title, items, action }) {
  return (
    <section className="row-section">
      <div className="row-head">
        <h2>{title}</h2>
        {action && <button type="button" className="link-btn" onClick={action}>See all</button>}
      </div>
      <div className="h-scroll">{items.map((e) => <EventCard key={e.id} e={e} />)}</div>
    </section>
  );
}
