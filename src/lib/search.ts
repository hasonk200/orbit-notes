import MiniSearch from 'minisearch';

const HAN = /\p{Script=Han}+/gu;
const fields = ['title', 'props', 'body', 'tags'] as const;
const weights = { title: 4, props: 1.5, body: 1, tags: 2 };
type SearchDoc = { id: string } & Record<typeof fields[number], string>;

export const normalizeText = (value: string) => value.normalize('NFKC').toLowerCase();

export const includesText = (text: string, query: string) => normalizeText(text).includes(normalizeText(query.trim()));

/** Keep Latin prefix/fuzzy matching and find Han phrases anywhere, including inside unspaced paragraphs. */
export function buildNoteSearch(documents: SearchDoc[]) {
  const normalized = documents.map((doc) => ({
    id: doc.id,
    title: normalizeText(doc.title), props: normalizeText(doc.props), body: normalizeText(doc.body), tags: normalizeText(doc.tags),
  }));
  const byId = new Map(normalized.map((doc) => [doc.id, doc]));
  const index = new MiniSearch<SearchDoc>({
    fields: [...fields],
    tokenize: (value) => value.replace(HAN, ' ').split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean),
    searchOptions: { boost: weights, prefix: true, fuzzy: 0.2, combineWith: 'AND' },
  });
  index.addAll(normalized);

  return (query: string, limit = 12) => {
    const text = normalizeText(query).trim();
    const phrases = [...new Set(text.match(HAN) ?? [])];
    const latin = text.replace(HAN, ' ').trim();
    const hasLatin = /[\p{L}\p{N}]/u.test(latin);
    if (!phrases.length && !hasLatin) return [];
    const candidates = hasLatin
      ? index.search(latin).map((result) => ({ id: String(result.id), score: result.score, terms: result.terms }))
      : normalized.map((doc) => ({ id: doc.id, score: 0, terms: [] as string[] }));
    if (!phrases.length) return candidates.slice(0, limit);

    return candidates.flatMap((candidate) => {
      const doc = byId.get(candidate.id)!;
      const scores = phrases.map((phrase) => Math.max(...fields.map((field) => doc[field].includes(phrase) ? weights[field] * 3 : 0)));
      if (scores.includes(0)) return [];
      return [{ ...candidate, score: candidate.score + scores.reduce((a, b) => a + b, 0), terms: [...phrases, ...candidate.terms] }];
    }).sort((a, b) => b.score - a.score).slice(0, limit);
  };
}
