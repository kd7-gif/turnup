import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import AuthLayout from './AuthLayout.jsx';
import PasswordField from '../components/ui/PasswordField.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) return setError('Enter your email and password.');
    setBusy(true);
    setError('');
    try {
      await login(form.email.trim(), form.password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Welcome back" sub="Log in to save events, follow hosts and see where your friends are going.">
      <form className="auth-form" onSubmit={submit} noValidate>
        {error && <p className="notice error" role="alert">{error}</p>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <PasswordField id="password" label="Password" autoComplete="current-password" value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        <p className="muted center">New to Turnup? <Link to="/register" state={location.state} className="link">Create an account</Link></p>
      </form>
      <details className="demo-box">
        <summary>Trying the demo?</summary>
        <p>Every sample account uses the password <code>turnup123</code>.</p>
        <ul>
          <li>Guest: <code>guest@turnup.demo</code></li>
          <li>Host: <code>host@turnup.demo</code></li>
          <li>Door staff: <code>door@turnup.demo</code></li>
        </ul>
      </details>
    </AuthLayout>
  );
}
