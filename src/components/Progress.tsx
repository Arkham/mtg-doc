import { useEffect, useRef, useState } from "react";
import type { Job } from "../../shared/types.ts";
import { api } from "../api.ts";

const ICON = { pending: "⏳", running: "🔄", done: "✅", error: "❌", skipped: "⏭" } as const;

export function Progress({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const j = await api.job(jobId);
        if (stop) return;
        setJob(j);
        if (j.status === "done") return doneRef.current();
        if (j.status === "running") setTimeout(poll, 1000);
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
      }
    };
    poll();
    return () => {
      stop = true;
    };
  }, [jobId]);

  return (
    <section className="panel narrow">
      <h1>Optimizing {job?.slug ?? "deck"}…</h1>
      <p className="muted small">
        This takes about 30–90 seconds. The deck folder is already saved.
      </p>
      <ul className="steps">
        {job?.steps.map((s) => (
          <li key={s.label} className={s.status}>
            <span className={s.status === "running" ? "spin" : ""}>{ICON[s.status]}</span> {s.label}
            {s.detail && <span className="muted small"> · {s.detail}</span>}
          </li>
        ))}
      </ul>
      {(job?.error || error) && <p className="error">{job?.error ?? error}</p>}
      {job?.status === "error" && <a href={`#/deck/${job.slug}`}>Open deck anyway →</a>}
    </section>
  );
}
