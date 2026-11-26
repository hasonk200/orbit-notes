import { useState } from 'react';
import { Bot, ChevronRight, Trash2 } from 'lucide-react';
import type { Obj } from '../db/schema';
import { saveObject } from '../db/indexers';
import { appendAiNote, MAX_AI_NOTE_LENGTH } from '../lib/aiNotes';
import { dateLabel, relativeTime } from '../lib/dates';
import { uid } from '../lib/uid';
import { useT } from '../store/uiStore';

/**
 * Notes left for future AI sessions, folded away under a note. AI apps read these before the
 * body (they come back from the API as ai_notes) and add to them with add_ai_note; the user can
 * read, add and delete entries here. They are stored apart from the note's body.
 */
export function AiNotesPanel({ obj }: { obj: Obj }) {
  const tr = useT();
  const notes = obj.aiNotes ?? [];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const editable = !obj.deletedAt;
  const last = notes.at(-1);
  const who = (by: string) => (by === 'me' ? tr('You') : by);

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    await saveObject(obj.id, (cur) => ({ aiNotes: appendAiNote(cur.aiNotes, { id: uid(), at: Date.now(), by: 'me', text }) }));
    setDraft('');
  };

  return (
    <section className={`ai-notes${open ? ' is-open' : ''}`}>
      <button type="button" className="ai-notes-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ChevronRight size={16} className="ai-notes-chevron" />
        <Bot size={16} className="ai-notes-icon" />
        <span className="ai-notes-title">{tr('AI notes')}</span>
        {notes.length > 0 && <span className="ai-notes-count">{notes.length}</span>}
        <span className="ai-notes-sub">
          {last ? tr('Last: {time} · {who}', { time: relativeTime(last.at, tr), who: who(last.by) }) : tr('For future AI sessions')}
        </span>
      </button>
      {open && (
        <div className="ai-notes-body">
          <p className="ai-notes-help">{tr('AI apps read these before the note itself, and add to them after making changes. You can leave a message for them too.')}</p>
          {notes.length === 0 && <p className="ai-notes-empty">{tr('No AI notes yet.')}</p>}
          <ol className="ai-notes-list">
            {[...notes].reverse().map((n) => (
              <li key={n.id} className={n.by === 'me' ? 'is-mine' : ''}>
                <div className="ai-notes-meta">
                  <strong>{who(n.by)}</strong>
                  <span title={dateLabel(new Date(n.at), tr, 'PPpp', 'yyyy年M月d日 HH:mm')}>{relativeTime(n.at, tr)}</span>
                  {editable && (
                    <button
                      type="button"
                      className="ai-notes-del"
                      aria-label={tr('Delete this AI note')}
                      onClick={() => {
                        if (window.confirm(tr('Delete this AI note?'))) void saveObject(obj.id, (cur) => ({ aiNotes: (cur.aiNotes ?? []).filter((x) => x.id !== n.id) }));
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <p>{n.text}</p>
              </li>
            ))}
          </ol>
          {editable && (
            <form
              className="ai-notes-form"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <textarea
                rows={2}
                maxLength={MAX_AI_NOTE_LENGTH}
                value={draft}
                placeholder={tr('Leave a message for future AI sessions…')}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void add();
                  }
                }}
              />
              <button type="submit" className="btn" disabled={!draft.trim()}>
                {tr('Add')}
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
