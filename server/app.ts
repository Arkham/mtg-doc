import { randomUUID } from "node:crypto";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import type { RecognitionResult } from "../shared/types.ts";
import { config, llmEnabled } from "./config.ts";
import {
  applyChatChanges,
  applyManaSuggestion,
  chatAboutDeck,
  readChat,
  refreshSynergies,
  startChatRerun,
} from "./chat.ts";
import { recognizeImages, recognizeText } from "./ocr.ts";
import { getJob, startOptimize } from "./pipeline.ts";
import { autocomplete, lookupExact, resolveNames } from "./sources/scryfall.ts";
import {
  HttpError,
  createDeckFolder,
  listDecks,
  readDeckFile,
  readInitial,
  readMeta,
  readReport,
  writeDeck,
  writeMeta,
} from "./storage.ts";

interface RecognitionJob {
  id: string;
  status: "running" | "done" | "error";
  phase: string;
  done: number;
  total: number;
  result?: RecognitionResult & { uploadToken: string };
  error?: string;
}

const recognitionJobs = new Map<string, RecognitionJob>();

/** Builds the API app. Static/Vite serving and listening happen in index.ts. */
export function createApp() {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024, files: 8 },
  });

  /** Uploaded photos are held briefly so they can be saved alongside the deck once the user confirms. */
  const pendingUploads = new Map<string, { files: { name: string; data: Buffer }[]; at: number }>();
  const UPLOAD_TTL_MS = 60 * 60 * 1000;

  const wrap =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) =>
      fn(req, res).catch(next);

  const OptionsSchema = z.object({
    maxSwaps: z.number().int().min(1).max(40).default(15),
    budgetPerCard: z.number().positive().nullable().default(null),
    budgetTotal: z.number().positive().nullable().default(null),
    bracket: z.number().int().min(1).max(5).nullable().default(null),
    tone: z.enum(["max", "balanced", "casual"]).default("max"),
    locked: z.array(z.string()).default([]),
    webResearch: z.boolean().default(true),
  });

  const SaveSchema = z.object({
    format: z.enum(["commander", "other"]),
    commanders: z.array(z.string()).max(2),
    deckName: z.string().nullable().default(null),
    entries: z
      .array(z.object({ name: z.string().min(1), qty: z.number().int().positive() }))
      .min(1),
    options: OptionsSchema,
    uploadToken: z.string().optional(),
  });

  app.get("/api/config", (_req, res) => {
    res.json({
      llm: llmEnabled(),
      model: config.llm.model,
      visionModel: config.llm.visionModel,
      webResearch: llmEnabled() && config.llm.webSearch,
    });
  });

  app.post(
    "/api/recognize",
    upload.array("images", 8),
    wrap(async (req, res) => {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
      if (!files.length && !text)
        return res.status(400).json({ error: "Upload an image or paste a decklist." });
      if (files.length && !llmEnabled()) {
        return res.status(400).json({
          error:
            "Image recognition needs LLM_API_KEY configured. You can paste a decklist instead.",
        });
      }
      if (!files.length) return res.json(await recognizeText(text));

      const uploadToken = randomUUID();
      const now = Date.now();
      for (const [k, v] of pendingUploads) if (now - v.at > UPLOAD_TTL_MS) pendingUploads.delete(k);
      pendingUploads.set(uploadToken, {
        files: files.map((f, i) => ({
          name: `${i + 1}-${path.basename(f.originalname).replace(/[^\w.-]/g, "_")}`,
          data: f.buffer,
        })),
        at: now,
      });
      // Photo recognition runs many model calls; clients poll the job for progress.
      const job: RecognitionJob = {
        id: randomUUID(),
        status: "running",
        phase: "Starting",
        done: 0,
        total: 1,
      };
      recognitionJobs.set(job.id, job);
      recognizeImages(
        files.map((f) => f.buffer),
        { onProgress: (p) => Object.assign(job, p) },
      ).then(
        (result) => Object.assign(job, { status: "done", result: { ...result, uploadToken } }),
        (err) =>
          Object.assign(job, {
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          }),
      );
      res.status(202).json({ jobId: job.id });
    }),
  );

  app.get("/api/recognize/:id", (req, res) => {
    const job = recognitionJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Recognition job not found" });
    res.json(job);
  });

  app.get(
    "/api/cards/autocomplete",
    wrap(async (req, res) => {
      const q = String(req.query.q ?? "");
      res.json(q.length >= 2 ? await autocomplete(q) : []);
    }),
  );

  app.post(
    "/api/cards/resolve",
    wrap(async (req, res) => {
      const { names } = z.object({ names: z.array(z.string()).max(200) }).parse(req.body);
      res.json(await resolveNames(names));
    }),
  );

  app.get(
    "/api/decks",
    wrap(async (_req, res) => res.json(await listDecks())),
  );

  app.post(
    "/api/decks",
    wrap(async (req, res) => {
      const body = SaveSchema.parse(req.body);
      if (body.format === "commander" && !body.commanders.length) {
        return res.status(400).json({ error: "Pick a commander first." });
      }
      const folderName =
        body.format === "commander" ? body.commanders.join(" ") : body.deckName || "deck";
      const slug = await createDeckFolder(folderName);
      const cmdrCards = body.commanders.length ? await lookupExact(body.commanders) : new Map();
      const firstCmdr = cmdrCards.get(body.commanders[0]);
      const uploads = body.uploadToken ? (pendingUploads.get(body.uploadToken)?.files ?? []) : [];
      if (body.uploadToken) pendingUploads.delete(body.uploadToken);
      await writeDeck(
        {
          slug,
          format: body.format,
          commanders: body.commanders,
          deckName: body.deckName,
          createdAt: new Date().toISOString(),
          options: body.options,
          image: firstCmdr?.imageArt ?? null,
        },
        body.entries,
        uploads,
      );
      const job = startOptimize(slug);
      res.json({ slug, jobId: job.id });
    }),
  );

  app.get(
    "/api/decks/:slug",
    wrap(async (req, res) => {
      const slug = String(req.params.slug);
      const [meta, report, initial] = await Promise.all([
        readMeta(slug),
        readReport(slug),
        readInitial(slug),
      ]);
      res.json({ meta, report, initial });
    }),
  );

  app.post(
    "/api/decks/:slug/optimize",
    wrap(async (req, res) => {
      const slug = String(req.params.slug);
      const meta = await readMeta(slug);
      if (req.body?.options) {
        meta.options = OptionsSchema.parse(req.body.options);
        await writeMeta(meta);
      }
      res.json({ slug, jobId: startOptimize(slug).id });
    }),
  );

  app.get(
    "/api/decks/:slug/files/:file",
    wrap(async (req, res) => {
      const file = z.enum(["initial.txt", "optimized.txt", "report.md"]).parse(req.params.file);
      res.type("text/plain").send(await readDeckFile(String(req.params.slug), file));
    }),
  );

  app.get(
    "/api/decks/:slug/chat",
    wrap(async (req, res) => res.json(await readChat(String(req.params.slug)))),
  );

  app.post(
    "/api/decks/:slug/chat",
    wrap(async (req, res) => {
      const { message, view } = z
        .object({
          message: z.string().trim().min(1).max(2000),
          view: z.enum(["original", "optimized"]).default("optimized"),
        })
        .parse(req.body);
      res.json(await chatAboutDeck(String(req.params.slug), message, view));
    }),
  );

  app.post(
    "/api/decks/:slug/chat/:messageId/apply",
    wrap(async (req, res) =>
      res.json(await applyChatChanges(String(req.params.slug), String(req.params.messageId))),
    ),
  );

  app.post(
    "/api/decks/:slug/chat/:messageId/rerun",
    wrap(async (req, res) => {
      const slug = String(req.params.slug);
      res.json({ slug, jobId: await startChatRerun(slug, String(req.params.messageId)) });
    }),
  );

  app.post(
    "/api/decks/:slug/mana-suggestions/:id/apply",
    wrap(async (req, res) =>
      res.json(await applyManaSuggestion(String(req.params.slug), String(req.params.id))),
    ),
  );

  app.post(
    "/api/decks/:slug/synergies",
    wrap(async (req, res) =>
      res.json(
        await refreshSynergies(
          String(req.params.slug),
          req.body?.mode === "more" ? "more" : "again",
        ),
      ),
    ),
  );

  app.get("/api/jobs/:id", (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  });

  app.use("/api", (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      err instanceof z.ZodError
        ? 400
        : err instanceof HttpError
          ? err.status
          : (err as NodeJS.ErrnoException)?.code === "ENOENT"
            ? 404
            : 500;
    if (status === 500) console.error(err);
    const message =
      err instanceof z.ZodError
        ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        : status === 404
          ? "Not found"
          : err instanceof Error
            ? err.message
            : String(err);
    res.status(status).json({ error: message });
  });

  return app;
}
