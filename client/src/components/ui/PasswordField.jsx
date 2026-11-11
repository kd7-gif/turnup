import { useState } from 'react';

/** Password input with a show/hide eye button. */
export default function PasswordField({ id, label, error, hint, ...props }) {
  const [show, setShow] = useState(false);
  const describedBy = [error && `${id}-err`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-wrap">
        <input id={id} type={show ? 'text' : 'password'} aria-invalid={error ? 'true' : 'false'}
          aria-describedby={describedBy} {...props} />
        <button type="button" className="eye" onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
            {show && <path d="M3 3l18 18" />}
          </svg>
        </button>
      </div>
      {hint && !error && <span id={`${id}-hint`} className="faint small">{hint}</span>}
      {error && <span id={`${id}-err`} className="error">{error}</span>}
    </div>
  );
}
