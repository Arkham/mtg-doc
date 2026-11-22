import fs from "node:fs/promises";
import path from "node:path";
import type { DeckChatMessage } from "../shared/types.ts";
import { config } from "./config.ts";
import { pendingEdits } from "./edit-queue.ts";
import { readMeta, writeAtomic } from "./storage.ts";

/** A deck's chat with the doc, oldest first, in its folder's chat.json. */
const chatPath = (slug: string) => path.join(config.decksDir, slug, "chat.json");

export async function readChat(slug: string): Promise<DeckChatMessage[]> {
  await readMeta(slug);
  const messages = await fs.readFile(chatPath(slug), "utf8").then(
    (t) => JSON.parse(t) as DeckChatMessage[],
    () => [],
  );
  // Applies run in this process's queue: one still marked as applying with nothing queued was
  // cut short by a restart.
  if (!pendingEdits(slug).length)
    for (const m of messages)
      if (m.apply?.kind === "applying")
        m.apply = { kind: "failed", error: "Interrupted before it finished; apply it again." };
  return messages;
}

const chatLocks = new Map<string, Promise<unknown>>();

/**
 * Read-modify-write of a deck's chat, one at a time: a reply and a background apply can finish at
 * the same moment, and neither may drop the other's messages.
 */
export function updateChat(
  slug: string,
  fn: (messages: DeckChatMessage[]) => DeckChatMessage[],
): Promise<DeckChatMessage[]> {
  const next = (chatLocks.get(slug) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const messages = fn(await readChat(slug));
      await writeAtomic(chatPath(slug), JSON.stringify(messages, null, 2));
      return messages;
    });
  chatLocks.set(slug, next);
  return next;
}

export const patchMessage = (
  slug: string,
  id: string,
  patch: (m: DeckChatMessage) => DeckChatMessage,
) => updateChat(slug, (ms) => ms.map((m) => (m.id === id ? patch(m) : m)));

/** Empties a deck's chat; the deck and its report stay as they are. */
export async function clearChat(slug: string) {
  await updateChat(slug, () => []);
}
