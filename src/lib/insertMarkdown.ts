import type { JSONContent } from '../db/schema';
import { nodeText } from './content';
import { markdownToBlocks } from './markdown';

const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock']);
const ITEMS = new Set(['listItem', 'taskItem']);
const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);

export class InsertError extends Error {
  constructor(public reason: 'not-found' | 'ambiguous' | 'empty') {
    super(reason);
  }
}

type Step = { parent: JSONContent; index: number };

const sameListFamily = (a?: string, b?: string) =>
  !!a && !!b && (a === b || (a !== 'taskList' && b !== 'taskList' && LISTS.has(a) && LISTS.has(b)));

/**
 * Insert Markdown next to the one line (paragraph, heading or code block) that contains `anchor`,
 * leaving the rest of the note untouched.
 * - Next to a list or to-do item: new items of the same kind join that list; anything else goes
 *   right after (or before) the whole list.
 * - Anywhere else: the new blocks go right after (or before) that line, at the same level.
 */
export function insertMarkdown(doc: JSONContent, anchor: string, markdown: string, position: 'after' | 'before' = 'after'): JSONContent {
  const blocks = markdownToBlocks(markdown);
  if (!blocks.length) throw new InsertError('empty');
  const next: JSONContent = structuredClone(doc);
  const hits: Step[][] = [];
  const visit = (node: JSONContent, path: Step[]) => {
    (node.content ?? []).forEach((child, index) => {
      const here = [...path, { parent: node, index }];
      if (TEXTBLOCKS.has(child.type ?? '')) {
        if (nodeText(child).includes(anchor)) hits.push(here);
        return;
      }
      visit(child, here);
    });
  };
  visit(next, []);
  if (!hits.length) throw new InsertError('not-found');
  if (hits.length > 1) throw new InsertError('ambiguous');
  const path = hits[0];
  const at = (step: Step) => step.index + (position === 'after' ? 1 : 0);
  const line = path[path.length - 1];
  const itemStep = path[path.length - 2];
  const item = itemStep?.parent.content?.[itemStep.index];

  if (item && ITEMS.has(item.type ?? '') && line.index === 0) {
    // The anchor is an item's own line: add items to its list, or place other blocks beside the whole list.
    const list = itemStep.parent;
    if (blocks.length === 1 && sameListFamily(list.type, blocks[0].type)) {
      list.content!.splice(at(itemStep), 0, ...(blocks[0].content ?? []));
      return next;
    }
    const outer = path.find((step) => LISTS.has(step.parent.content?.[step.index]?.type ?? ''))!;
    outer.parent.content!.splice(at(outer), 0, ...blocks);
    return next;
  }
  line.parent.content!.splice(at(line), 0, ...blocks);
  return next;
}
