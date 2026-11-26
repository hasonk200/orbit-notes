/** One line of a comparison: in both versions, only in the first (removed) or only in the second (added). */
export type DiffLine = { kind: 'same' | 'removed' | 'added'; text: string };

/**
 * Line-by-line comparison of two texts (longest common subsequence).
 * Very long texts fall back to "all removed, all added" rather than freezing the page.
 */
export function diffLines(a: string, b: string, limit = 4000): DiffLine[] {
  const x = a.split('\n');
  const y = b.split('\n');
  // Trim the shared start and end first: conflicts usually differ in a few lines.
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  const head = x.slice(0, start).map((text): DiffLine => ({ kind: 'same', text }));
  const tail = x.slice(endX).map((text): DiffLine => ({ kind: 'same', text }));
  const mx = x.slice(start, endX);
  const my = y.slice(start, endY);
  if (mx.length * my.length > limit * limit) {
    return [...head, ...mx.map((text): DiffLine => ({ kind: 'removed', text })), ...my.map((text): DiffLine => ({ kind: 'added', text })), ...tail];
  }
  // lcs[i][j] = length of the longest common subsequence of mx[i..] and my[j..]
  const lcs = Array.from({ length: mx.length + 1 }, () => new Uint32Array(my.length + 1));
  for (let i = mx.length - 1; i >= 0; i--) {
    for (let j = my.length - 1; j >= 0; j--) {
      lcs[i][j] = mx[i] === my[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < mx.length && j < my.length) {
    if (mx[i] === my[j]) {
      middle.push({ kind: 'same', text: mx[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) middle.push({ kind: 'removed', text: mx[i++] });
    else middle.push({ kind: 'added', text: my[j++] });
  }
  while (i < mx.length) middle.push({ kind: 'removed', text: mx[i++] });
  while (j < my.length) middle.push({ kind: 'added', text: my[j++] });
  return [...head, ...middle, ...tail];
}

/** Changed lines with a little context; long unchanged stretches become a single gap marker (null). */
export function diffHunks(lines: DiffLine[], context = 1): (DiffLine | null)[] {
  const keep = lines.map((l) => l.kind !== 'same');
  const show = lines.map((_, i) => lines.slice(Math.max(0, i - context), i + context + 1).some((l) => l.kind !== 'same') || keep[i]);
  const out: (DiffLine | null)[] = [];
  lines.forEach((l, i) => {
    if (show[i]) out.push(l);
    else if (out.at(-1) !== null) out.push(null);
  });
  if (out.at(-1) === null) out.pop();
  return out;
}

export function diffCounts(lines: DiffLine[]) {
  return { removed: lines.filter((l) => l.kind === 'removed').length, added: lines.filter((l) => l.kind === 'added').length };
}
