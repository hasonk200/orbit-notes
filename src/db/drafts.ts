type Flush = () => Promise<void>;
const drafts = new Map<string, Set<Flush>>();

export function registerDraft(id: string, flush: Flush) {
  const callbacks = drafts.get(id) ?? new Set<Flush>();
  callbacks.add(flush);
  drafts.set(id, callbacks);
  return () => {
    callbacks.delete(flush);
    if (!callbacks.size) drafts.delete(id);
  };
}

export async function flushDrafts(id: string) {
  await Promise.all(Array.from(drafts.get(id) ?? [], (flush) => flush()));
}
