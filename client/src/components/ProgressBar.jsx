export default function ProgressBar({ value = 0, label }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="progress" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label || 'Progress'}>
      <div className="progress-bar" style={{ width: `${v}%` }} />
      <span className="progress-label">{v}%</span>
    </div>
  );
}
