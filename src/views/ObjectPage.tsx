import { useCallback, useEffect, useRef, useState } from 'react';
import { Columns2, ImagePlus, Pin, PinOff, RotateCcw, Trash, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { togglePinned, useData, useObject } from '../store/dataStore';
import { objPath, useOpen, usePane } from '../store/pane';
import { restoreObject, saveObject, softDelete } from '../db/indexers';
import { registerDraft } from '../db/drafts';
import { saveImage, useBlobUrl } from '../db/blobs';
import { ObjectEditor } from '../editor/Editor';
import { PropertyPanel } from '../components/PropertyPanel';
import { Backlinks } from '../components/Backlinks';
import { EmojiPicker, TypeBadge } from '../components/TypeIcon';
import { ConvertTypeMenu } from '../components/ConvertTypeMenu';

function TitleInput({ id, value, autoFocus, disabled }: { id: string; value: string; autoFocus?: boolean; disabled?: boolean }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const t = useRef<number>(0);
  const focused = useRef(false);
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
  return (
    <textarea
      ref={ref}
      className="obj-title"
      rows={1}
      placeholder="Untitled"
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
      onChange={(e) => {
        const nv = e.target.value.replace(/\n/g, '');
        setV(nv);
        pending.current = nv;
        window.clearTimeout(t.current);
        t.current = window.setTimeout(flushInBackground, 400);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.currentTarget.closest('.obj-page')?.querySelector('.ProseMirror') as HTMLElement | null)?.focus();
        }
      }}
    />
  );
}

export function ObjectPage({ id, isNew }: { id: string; isNew?: boolean }) {
  const obj = useObject(id);
  const type = useData((s) => s.types.find((t) => t.id === obj?.typeId));
  const pinned = useData((s) => s.pinned.includes(id));
  const ready = useData((s) => s.ready);
  const cover = useBlobUrl(obj?.cover);
  const { pane, replace } = usePane();
  const open = useOpen();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const iconBtn = useRef<HTMLButtonElement>(null);
  const typeBtn = useRef<HTMLDivElement>(null);

  // drop ?new=1 from the URL once used
  useEffect(() => {
    if (isNew) replace(`/o/${id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!obj) {
    return <div className="empty-state">{ready ? <h2>This object doesn’t exist anymore.</h2> : null}</div>;
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

  return (
    <div className="obj-page" style={{ ['--type-color' as any]: type?.color }}>
      {obj.syncConflictOf && !obj.deletedAt && (
        <div className="banner warn">
          Recovered version from a sync conflict.
          <button type="button" className="btn" onClick={(e) => open('/settings', e)}>Review versions</button>
        </div>
      )}
      {obj.deletedAt && (
        <div className="banner warn">
          This object is in the Trash.
          <button type="button" className="btn" onClick={() => restoreObject(obj.id)}>
            <RotateCcw size={14} /> Restore
          </button>
        </div>
      )}
      {cover && (
        <div className="obj-cover">
          <img src={cover} alt="" />
          <div className="obj-cover-actions">
            <button type="button" className="btn small" onClick={addCover}>
              Change cover
            </button>
            <button type="button" className="btn small" onClick={() => saveObject(obj.id, { cover: null })}>
              <X size={13} /> Remove
            </button>
          </div>
        </div>
      )}
      <div className="obj-inner">
        <div className="obj-toolbar">
          <div ref={typeBtn}>
            <TypeBadge type={type} onClick={() => setConvertOpen(true)} />
          </div>
          <span className="muted small">Edited {formatDistanceToNow(obj.updatedAt, { addSuffix: true })}</span>
          <div className="spacer" />
          {!cover && (
            <button type="button" className="icon-btn" title="Add cover image" onClick={addCover}>
              <ImagePlus size={16} />
            </button>
          )}
          <button type="button" className="icon-btn" title={pinned ? 'Unpin' : 'Pin to sidebar'} onClick={() => togglePinned(obj.id)}>
            {pinned ? <PinOff size={16} /> : <Pin size={16} />}
          </button>
          {pane === 'main' && (
            <button type="button" className="icon-btn" title="Open in split view" onClick={() => open(objPath(obj.id), null, { split: true })}>
              <Columns2 size={16} />
            </button>
          )}
          {!obj.deletedAt && (
            <button type="button" className="icon-btn danger" title="Move to Trash" onClick={() => softDelete(obj.id)}>
              <Trash size={16} />
            </button>
          )}
        </div>

        <div className="obj-head">
          <button type="button" ref={iconBtn} className="obj-icon" onClick={() => setEmojiOpen(true)} title="Change icon">
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
        <Backlinks objectId={obj.id} />
      </div>
    </div>
  );
}
