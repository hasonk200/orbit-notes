import type { AiNote, Obj } from '../db/schema';
import type { Translate } from './i18n';

/** The one note every AI app reads first: the user's standing instructions for AI. */
export const HANDBOOK_ID = 'ai-handbook';
export const MAX_AI_NOTES = 200;
export const MAX_AI_NOTE_LENGTH = 4000;

export function handbookTitle(t?: Translate) {
  return t && t.language === 'en' ? '🤖 AI handbook' : '🤖 AI 交接簿';
}

/** Starting body of the handbook, as Markdown. */
export function handbookTemplate(t?: Translate) {
  if (t && t.language === 'en') {
    return [
      '> **What this is**: shared instructions for every AI app connected to Orbit. AI apps read this page before they start. Edit it any time; AI apps leave messages in the AI notes at the bottom.',
      '',
      '## About me',
      '- (What should AI know about you? Name, language, habits.)',
      '',
      '## Rules',
      '- Never delete information when editing a note.',
    ].join('\n');
  }
  return [
    '> **用途**：給所有連接 Orbit 的 AI 看的共同說明。AI 開始工作前會先讀這一頁。你可以隨時修改，AI 會在底部的「AI 備註」留言。',
    '',
    '## 關於我',
    '- （寫下希望 AI 知道的事，例如稱呼、語言、習慣）',
    '',
    '## 規矩',
    '- 改筆記時不要刪資料。',
  ].join('\n');
}

/** Add a note, newest last, keeping the list bounded. */
export function appendAiNote(list: AiNote[] | undefined, note: AiNote): AiNote[] {
  return [...(list ?? []), note].slice(-MAX_AI_NOTES);
}

export const aiNotesOf = (o: Pick<Obj, 'aiNotes'> | null | undefined) => o?.aiNotes ?? [];
