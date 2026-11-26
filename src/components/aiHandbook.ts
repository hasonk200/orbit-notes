import { createObject, restoreObject } from '../db/indexers';
import { db } from '../db/schema';
import { HANDBOOK_ID, handbookTemplate, handbookTitle } from '../lib/aiNotes';
import type { Translate } from '../lib/i18n';
import { markdownToBlocks } from '../lib/markdown';
import { objPath } from '../store/pane';

/** Path to the AI handbook, creating it from the template the first time. */
export async function ensureHandbook(tr: Translate) {
  const existing = await db.objects.get(HANDBOOK_ID);
  if (!existing) {
    await createObject('page', { id: HANDBOOK_ID, title: handbookTitle(tr), content: { type: 'doc', content: markdownToBlocks(handbookTemplate(tr)) } });
  } else if (existing.deletedAt) {
    await restoreObject(HANDBOOK_ID);
  }
  return objPath(HANDBOOK_ID);
}
