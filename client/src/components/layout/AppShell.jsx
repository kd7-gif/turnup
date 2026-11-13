import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { IconCompass, IconHeart, IconScan, IconTicket, IconUser } from '@tabler/icons-react';
import { useAuth } from '../../context/AuthContext.jsx';
import Avatar from '../ui/Avatar.jsx';

export function Logo() {
  return <span className="logo">turnup<i>.</i></span>;
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="container topbar-inner">
          <Link to="/" className="brand" aria-label="Turnup home"><Logo /></Link>
          <nav className="topnav" aria-label="Main">
            <NavLink to="/" end>Discover</NavLink>
            <NavLink to="/tickets">My tickets</NavLink>
            <NavLink to="/saved">Saved</NavLink>
            {user?.can_check_in && <NavLink to="/door">Door</NavLink>}
          </nav>
          <div className="topbar-actions">
            {user ? (
              <>
                <span className="hello">Hi, <strong>{user.full_name.split(' ')[0]}</strong></span>
                <Avatar name={user.full_name} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { await logout(); navigate('/'); }}>Log out</button>
              </>
            ) : (
              <>
                <Link to="/login" className="btn btn-ghost btn-sm">Log in</Link>
                <Link to="/register" className="btn btn-primary btn-sm">Sign up</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main><Outlet /></main>

      <nav className="tabbar" aria-label="Main">
        <NavLink to="/" end><IconCompass size={24} aria-hidden="true" />Discover</NavLink>
        <NavLink to="/tickets"><IconTicket size={24} aria-hidden="true" />Tickets</NavLink>
        <NavLink to="/saved"><IconHeart size={24} aria-hidden="true" />Saved</NavLink>
        {user?.can_check_in && <NavLink to="/door"><IconScan size={24} aria-hidden="true" />Door</NavLink>}
        {!user && <NavLink to="/login"><IconUser size={24} aria-hidden="true" />Log in</NavLink>}
      </nav>

      <footer className="footer">
        <div className="container footer-row">
          <Logo />
          <p>Find the move. Bring your friends.</p>
          <p className="faint">Lagos · Abuja · Ibadan</p>
        </div>
      </footer>
    </div>
  );
}
