import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import AuthLayout from './AuthLayout.jsx';
import PasswordField from '../components/ui/PasswordField.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', city: 'Lagos', password: '' });
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setFields({ ...fields, [k]: undefined }); };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register(form);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
      setFields(err.fields || {});
    } finally {
      setBusy(false);
    }
  };

  const input = (key, label, props = {}) => (
    <div className="field">
      <label htmlFor={key}>{label}</label>
      <input id={key} value={form[key]} onChange={set(key)} aria-invalid={fields[key] ? 'true' : 'false'}
        aria-describedby={fields[key] ? `${key}-err` : undefined} {...props} />
      {fields[key] && <span id={`${key}-err`} className="error">{fields[key]}</span>}
    </div>
  );

  return (
    <AuthLayout title="Join Turnup" sub="Find the move, save your favourites and see where your friends are going.">
      <form className="auth-form" onSubmit={submit} noValidate>
        {error && <p className="notice error" role="alert">{error}</p>}
        {input('full_name', 'Full name', { autoComplete: 'name' })}
        {input('email', 'Email', { type: 'email', autoComplete: 'email' })}
        {input('phone', 'Phone number', { type: 'tel', autoComplete: 'tel', placeholder: '0803 123 4567' })}
        <div className="field">
          <label htmlFor="city">Your city</label>
          <select id="city" value={form.city} onChange={set('city')}>
            <option>Lagos</option><option>Abuja</option><option>Ibadan</option>
          </select>
        </div>
        <PasswordField id="password" label="Password" autoComplete="new-password" value={form.password}
          onChange={set('password')} error={fields.password} hint="At least 8 characters." />
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        <p className="muted center">Already have an account? <Link to="/login" state={location.state} className="link">Log in</Link></p>
      </form>
    </AuthLayout>
  );
}
