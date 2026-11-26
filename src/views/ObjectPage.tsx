import { useT } from '../store/uiStore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Columns2, ImagePlus, Link2, Pin, PinOff, RotateCcw, Shapes, Trash, X } from 'lucide-react';
import { relativeTime } from '../lib/dates';
import { isComposing } from '../lib/keyboard';
import { togglePinned, useData, useObject } from '../store/dataStore';
import { objPath, useOpen, usePane } from '../store/pane';
import { moveToSpace, restoreObject, saveObject, softDelete } from '../db/indexers';
import { AI_DOC_TYPE, aiDocStatus, otherSpace, spaceOf } from '../lib/spaces';
import { useUI } from '../store/uiStore';
import { registerDraft } from '../db/drafts';
import { saveImage, useBlobUrl } from '../db/blobs';
import { ObjectEditor } from '../editor/Editor';
import { PropertyPanel } from '../components/PropertyPanel';
import { Backlinks } from '../components/Backlinks';
import { AiNotesPanel } from '../components/AiNotesPanel';
import { TaskRow } from '../components/TaskRow';
import { EmojiPicker, TypeBadge } from '../components/TypeIcon';
import { ConvertTypeMenu } from '../components/ConvertTypeMenu';
import { MobileHeader } from '../mobile/MobileHeader';
import type { MenuAction } from '../mobile/BottomSheet';
import { copyObjectLink } from '../mobile/copyLink';

function TitleInput({ id, value, autoFocus, disabled }: { id: string; value: string; autoFocus?: boolean; disabled?: boolean }) {
  const tr = useT();
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const t = useRef<number>(0);
  const focused = useRef(false);
  const composing = useRef(false);
  const latestValue = useRef(value);
  latestValue.current = value;
  const pending = useRef<string | null>(null);
  const write = useRef(Promise.resolve());
  const flush = useCallback(() => {
    window.clearTimeout(t.current);
    const title = pending.current;
    if (title === null) return write.current;
    pending.current = null;
    const next = write.current.catch(() => {}).then(() => saveObject(id, { title })).catch((error: unknown) => {
      if (pending.current === null && write.current === next) pending.current = title;
      throw error;
    });
    write.current = next;
    return next;
  }, [id]);
  const flushInBackground = useCallback(() => {
    void flush().catch((error) => console.error('Orbit could not save the title', error));
  }, [flush]);
  useEffect(() => {
    const unregister = registerDraft(id, flush);
    return () => {
      flushInBackground();
      unregister();
    };
  }, [flush, flushInBackground, id]);
  useEffect(() => {
    if (!focused.current) setV(value);
  }, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = el.scrollHeight + 'px';
  }, [v]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const updateTitle = (title: string) => {
    const next = title.replace(/\n/g, '');
    setV(next);
    if (composing.current) return;
    pending.current = next;
    window.clearTimeout(t.current);
    t.current = window.setTimeout(flushInBackground, 400);
  };
  return (
    <textarea
      ref={ref}
      className="obj-title"
      rows={1}
      placeholder={tr('Untitled')}
      aria-label={tr('Title')}
      value={v}
      disabled={disabled}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        if (pending.current === null) {
          void write.current.then(() => {
            if (!focused.current && pending.current === null) setV(latestValue.current);
          }).catch(() => {});
        }
        flushInBackground();
      }}
      onChange={(e) => updateTitle(e.currentTarget.value)}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(e) => {
        composing.current = false;
        updateTitle(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isComposing(e.nativeEvent)) {
          e.preventDefault();
          (e.currentTarget.closest('.obj-page')?.querySelector('.ProseMirror') as HTMLElement | null)?.focus();
        }
      }}
    />
  );
}

export function ObjectPage({ id, isNew }: { id: string; isNew?: boolean }) {
  const tr = useT();
  const obj = useObject(id);
  const type = useData((s) => s.types.find((t) => t.id === obj?.typeId));
  const pinned = useData((s) => s.pinned.includes(id));
  const ready = useData((s) => s.ready);
  const tasks = useData((s) => s.tasks);
  const objects = useData((s) => s.objects);
  const linkedTasks = tasks.filter(
    (t) => t.contextId === id && t.objectId !== id && t.text.trim() !== '' && !objects.find((o) => o.id === t.objectId)?.deletedAt,
  );
  const cover = useBlobUrl(obj?.cover);
  const { pane, replace } = usePane();
  const open = useOpen();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const currentSpace = useUI((s) => s.space);
  const iconBtn = useRef<HTMLButtonElement>(null);
  const typeBtn = useRef<HTMLDivElement>(null);

  // drop ?new=1 from the URL once used
  useEffect(() => {
    if (isNew && obj) replace(`/o/${id}`);
  }, [id, isNew, obj, replace]);

  if (!obj) {
    return <div className="empty-state">{ready ? <h2>{tr('This object doesn’t exist anymore.')}</h2> : null}</div>;
  }

  const addCover = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (f) saveObject(obj.id, { cover: await saveImage(f) });
    };
    input.click();
  };

  const space = spaceOf(obj);
  const target = otherSpace(space);
  const moveLabel = tr(target === 'ai' ? 'Move to the AI workspace' : 'Move to my space');
  const move = () => void moveToSpace(obj.id, target);

  // On phones these live in the "⋯" sheet instead of the small toolbar icons.
  const mobileActions: MenuAction[] = [
    { key: 'pin', icon: pinned ? <PinOff size={20} /> : <Pin size={20} />, label: tr(pinned ? 'Unpin from Home' : 'Pin to Home'), onClick: () => void togglePinned(obj.id) },
    ...(cover
      ? [{ key: 'cover', icon: <ImagePlus size={20} />, label: tr('Change cover'), onClick: addCover }]
      : [{ key: 'cover', icon: <ImagePlus size={20} />, label: tr('Add cover image'), onClick: addCover }]),
    { key: 'type', icon: <Shapes size={20} />, label: tr('Change type'), onClick: () => setConvertOpen(true) },
    { key: 'space', icon: <ArrowLeftRight size={20} />, label: moveLabel, onClick: move },
    { key: 'link', group: 1, icon: <Link2 size={20} />, label: tr('Copy link'), onClick: () => void copyObjectLink(obj.id) },
    ...(obj.deletedAt
      ? [{ key: 'restore', group: 2, icon: <RotateCcw size={20} />, label: tr('Restore'), onClick: () => void restoreObject(obj.id) }]
      : [{ key: 'trash', group: 2, danger: true, icon: <Trash size={20} />, label: tr('Move to Trash'), onClick: () => void softDelete(obj.id) }]),
  ];

  return (
    <div className="obj-page" style={{ ['--type-color' as any]: type?.color }}>
      <MobileHeader actions={mobileActions} menuLabel={tr('Note actions')} />
      {obj.syncConflictOf && !obj.deletedAt && (
        <div className="banner warn">
          {tr('Recovered version from a sync conflict.')}
          <button type="button" className="btn" onClick={(e) => open('/settings', e)}>{tr('Review versions')}</button>
        </div>
      )}
      {obj.deletedAt && (
        <div className="banner warn">
          {tr('This object is in the Trash.')}
          <button type="button" className="btn" onClick={() => restoreObject(obj.id)}>
            <RotateCcw size={14} /> {tr('Restore')}
          </button>
        </div>
      )}
      {obj.typeId === AI_DOC_TYPE && space === 'ai' && aiDocStatus(obj) === 'Adopted' && !obj.deletedAt && (
        <div className="banner ai-adopted-banner">
          {tr('You adopted this document. Move it to your space to keep it with your own notes.')}
          <button type="button" className="btn" onClick={move}>
            <ArrowLeftRight size={14} /> {tr('Move to my space')}
          </button>
        </div>
      )}
      {cover && (
        <div className="obj-cover">
          <img src={cover} alt="" />
          <div className="obj-cover-actions">
            <button type="button" className="btn small" onClick={addCover}>
              {tr('Change cover')}
            </button>
            <button type="button" className="btn small" onClick={() => saveObject(obj.id, { cover: null })}>
              <X size={13} /> {tr('Remove')}
            </button>
          </div>
        </div>
      )}
      <div className="obj-inner">
        <div className="obj-toolbar">
          <div ref={typeBtn}>
            <TypeBadge type={type} onClick={() => setConvertOpen(true)} />
          </div>
          {(space === 'ai' || currentSpace === 'ai') && (
            <span className={`space-chip is-${space}`} title={tr('This note is in {space}', { space: tr(space === 'ai' ? 'AI workspace' : 'My space') })}>
              {space === 'ai' ? '🤖' : '🪐'} {tr(space === 'ai' ? 'AI workspace' : 'My space')}
            </span>
          )}
          <span className="muted small">{tr('Edited {time}', { time: relativeTime(obj.updatedAt, tr) })}</span>
          <div className="spacer" />
          {!cover && (
            <button type="button" className="icon-btn" title={tr('Add cover image')} onClick={addCover}>
              <ImagePlus size={16} />
            </button>
          )}
          <button type="button" className="icon-btn" title={moveLabel} aria-label={moveLabel} onClick={move}>
            <ArrowLeftRight size={16} />
          </button>
          <button type="button" className="icon-btn" title={pinned ? tr('Unpin') : tr('Pin to sidebar')} onClick={() => togglePinned(obj.id)}>
            {pinned ? <PinOff size={16} /> : <Pin size={16} />}
          </button>
          {pane === 'main' && (
            <button type="button" className="icon-btn" title={tr('Open in split view')} onClick={() => open(objPath(obj.id), null, { split: true })}>
              <Columns2 size={16} />
            </button>
          )}
          {!obj.deletedAt && (
            <button type="button" className="icon-btn danger" title={tr('Move to Trash')} onClick={() => softDelete(obj.id)}>
              <Trash size={16} />
            </button>
          )}
        </div>

        <div className="obj-head">
          <button type="button" ref={iconBtn} className="obj-icon" onClick={() => setEmojiOpen(true)} title={tr('Change icon')}>
            {obj.icon || type?.icon || '📄'}
          </button>
          <TitleInput key={obj.id} id={obj.id} value={obj.title} autoFocus={isNew} disabled={!!obj.deletedAt} />
        </div>
        {emojiOpen && (
          <EmojiPicker
            anchor={iconBtn.current}
            onClose={() => setEmojiOpen(false)}
            onPick={(e) => {
              saveObject(obj.id, { icon: e });
              setEmojiOpen(false);
            }}
          />
        )}
        {convertOpen && <ConvertTypeMenu obj={obj} anchor={typeBtn.current} onClose={() => setConvertOpen(false)} />}

        <PropertyPanel obj={obj} type={type} />
        <div className="obj-editor">
          <ObjectEditor key={obj.id} obj={obj} />
        </div>
        <AiNotesPanel obj={obj} />
        {linkedTasks.length > 0 && (
          <section className="ctx-tasks-section">
            <h3>
              Linked Tasks <span className="count">{linkedTasks.length}</span>
            </h3>
            {linkedTasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </section>
        )}
        <Backlinks objectId={obj.id} />
      </div>
    </div>
  );
}
