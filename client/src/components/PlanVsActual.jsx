import ProgressBar from './ProgressBar.jsx';
import { formatMinutes } from '../format.js';

/** Planned vs actual summary used on My Day, the team board and EOD review. */
export default function PlanVsActual({ m }) {
  return (
    <div className="pva">
      <div>
        <div className="small muted">Tasks completed</div>
        <strong>{m.completedCount} of {m.plannedCount}</strong>
        <ProgressBar value={m.completionPct} label="Tasks completed" />
      </div>
      <div>
        <div className="small muted">Planned time delivered</div>
        <strong>{formatMinutes(m.completedMinutes)} of {formatMinutes(m.plannedMinutes)}</strong>
        <ProgressBar value={m.minutesPct} label="Planned time delivered" />
      </div>
      <div className="small muted">{m.inProgressCount} in progress · {m.pendingCount} pending</div>
    </div>
  );
}
