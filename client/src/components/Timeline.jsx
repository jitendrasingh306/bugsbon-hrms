import { formatDateTime } from '../format.js';

export default function Timeline({ items }) {
  if (!items?.length) return <p className="muted">No activity yet.</p>;
  return (
    <ol className="timeline">
      {[...items].reverse().map((h, i) => (
        <li key={i}>
          <div><strong>{h.action.replace(/_/g, ' ')}</strong> <span className="muted small">by {h.byName || 'system'} · {formatDateTime(h.at)}</span></div>
          {h.note ? <div className="small">{h.note}</div> : null}
        </li>
      ))}
    </ol>
  );
}
