import { useEffect, useRef, useState } from "react";
import type { Job, JobStep } from "../../shared/types.ts";
import { api } from "../api.ts";

function StepIcon({ status }: { status: JobStep["status"] }) {
  if (status === "running") return <span className="spinner step-icon" aria-label="running" />;
  const glyph = { pending: "○", done: "✓", error: "✕", skipped: "–" }[status];
  return (
    <span className={`step-icon ${status}`} aria-label={status}>
      {glyph}
    </span>
  );
}

export function Progress({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const state = { stopped: false };
    const poll = async () => {
      try {
        const j = await api.job(jobId);
        if (state.stopped) return;
        setJob(j);
        if (j.status === "done") return doneRef.current();
        if (j.status === "running") setTimeout(poll, 1000);
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
      }
    };
    poll();
    return () => {
      state.stopped = true;
    };
  }, [jobId]);

  const finished =
    job?.steps.filter((s) => s.status === "done" || s.status === "skipped").length ?? 0;
  const pct = job ? Math.round((finished / job.steps.length) * 100) : 0;

  return (
    <section className="panel narrow">
      <h1>Optimizing your deck</h1>
      <p className="muted">
        Usually 30–90 seconds. Your list is already saved in <code>decks/{job?.slug ?? "…"}/</code>.
      </p>
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      <ul className="steps">
        {job?.steps.map((s) => (
          <li key={s.label} className={s.status}>
            <StepIcon status={s.status} />
            <div>
              {s.label}
              {s.detail && <div className="muted small">{s.detail}</div>}
            </div>
          </li>
        ))}
      </ul>
      {(job?.error || error) && <p className="error">{job?.error ?? error}</p>}
      {job?.status === "error" && <a href={`#/deck/${job.slug}`}>Open deck anyway →</a>}
    </section>
  );
}
