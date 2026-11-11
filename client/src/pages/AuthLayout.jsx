export default function AuthLayout({ title, sub, children }) {
  return (
    <div className="auth">
      <aside className="auth-art" aria-hidden="true">
        <img src="/img/events/9005505.webp" alt="" />
        <p className="auth-art-text">Your city is full of plans. Find yours, and bring your friends.</p>
      </aside>
      <section className="auth-form-wrap">
        <div className="auth-form-inner">
          <h1>{title}</h1>
          <p className="muted">{sub}</p>
          {children}
        </div>
      </section>
    </div>
  );
}
