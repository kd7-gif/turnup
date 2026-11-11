const COLOURS = ['#ff5a1f', '#2340ff', '#0f8a4c', '#b0175f', '#6a2bc2', '#d63f06', '#0d6a62', '#244b78'];

/** A coloured circle with initials. The colour is picked from the name, so a person always gets the same one. */
export default function Avatar({ name, size }) {
  const initials = name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  const colour = COLOURS[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % COLOURS.length];
  return (
    <span className="avatar" style={{ background: colour, ...(size ? { width: size, height: size } : {}) }} aria-hidden="true">
      {initials}
    </span>
  );
}

export function Faces({ names }) {
  return <span className="faces">{names.map((n) => <Avatar key={n} name={n} />)}</span>;
}
