import type {
  DeckSummary,
  Job,
  OptimizeOptions,
  RecognitionResult,
  Report,
  SaveDeckRequest,
} from "../shared/types.ts";

/** Static builds are read-only and load pre-exported JSON instead of calling the server. */
export const IS_STATIC = import.meta.env.VITE_STATIC === "1";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export interface AppConfig {
  llm: boolean;
  model: string;
  visionModel: string;
  webResearch: boolean;
}

export type Recognition = RecognitionResult & { uploadToken?: string };

export interface RecognitionJob {
  id: string;
  status: "running" | "done" | "error";
  phase: string;
  done: number;
  total: number;
  result?: Recognition;
  error?: string;
}

export interface DeckDetail {
  meta: {
    slug: string;
    format: string;
    commanders: string[];
    options: OptimizeOptions;
    createdAt: string;
  };
  report: Report | null;
  initial: string;
}

export type DeckFile = "initial.txt" | "optimized.txt" | "report.md";

export const fileUrl = (slug: string, file: DeckFile) =>
  IS_STATIC ? `data/decks/${slug}/${file}` : `/api/decks/${slug}/files/${file}`;

export const api = {
  config: () =>
    IS_STATIC ? Promise.resolve(null) : request<AppConfig>("/api/config").catch(() => null),
  decks: () => request<DeckSummary[]>(IS_STATIC ? "data/decks.json" : "/api/decks"),
  deck: (slug: string) =>
    request<DeckDetail>(IS_STATIC ? `data/decks/${slug}/detail.json` : `/api/decks/${slug}`),
  /** Text resolves immediately; photos return a job to poll with `recognitionJob`. */
  recognize: (images: File[], text: string) => {
    const form = new FormData();
    for (const f of images) form.append("images", f);
    if (text) form.append("text", text);
    return request<Recognition | { jobId: string }>("/api/recognize", {
      method: "POST",
      body: form,
    });
  },
  recognitionJob: (id: string) => request<RecognitionJob>(`/api/recognize/${id}`),
  resolve: (names: string[]) =>
    request<
      {
        requested: string;
        card: Recognition["entries"][number]["card"] | null;
        status: "exact" | "fuzzy" | "unresolved";
      }[]
    >("/api/cards/resolve", json({ names })),
  autocomplete: (q: string) =>
    request<string[]>(`/api/cards/autocomplete?q=${encodeURIComponent(q)}`),
  save: (body: SaveDeckRequest & { uploadToken?: string }) =>
    request<{ slug: string; jobId: string }>("/api/decks", json(body)),
  reoptimize: (slug: string, options: OptimizeOptions) =>
    request<{ slug: string; jobId: string }>(`/api/decks/${slug}/optimize`, json({ options })),
  job: (id: string) => request<Job>(`/api/jobs/${id}`),
};
