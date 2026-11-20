import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash, X } from 'lucide-react';
import { db, uid, type JSONContent, type ObjType, type PropertyDef, type PropertyKind } from '../db/schema';
import { convertType, reindexAll } from '../db/indexers';
import { useData } from '../store/dataStore';
import { useUI } from '../store/uiStore';
import { RichEditor } from '../editor/Editor';
import { emptyDoc } from '../lib/content';
import { EmojiPicker } from './TypeIcon';
import { Modal } from './Popover';

const COLORS = ['#6d5efc', '#3f9bd8', '#2fa57a', '#e5b12e', '#e0864a', '#d9546e', '#b05cc9', '#4bb3a8', '#8b8a86', '#5b7083'];
const KINDS: [PropertyKind, string][] = [
  ['text', 'Text'],
  ['number', 'Number'],
  ['date', 'Date'],
  ['select', 'Select'],
  ['checkbox', 'Checkbox'],
  ['url', 'URL'],
  ['relation', 'Relation (link to objects)'],
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'prop';

export function TypeEditorModal({ typeId }: { typeId: string }) {
  const types = useData((s) => s.types);
  const objects = useData((s) => s.objects);
  const setTypeEditor = useUI((s) => s.setTypeEditor);
  const existing = typeId === 'new' ? undefined : types.find((t) => t.id === typeId);
  const [draft, setDraft] = useState<ObjType>(
    () =>
      existing
        ? JSON.parse(JSON.stringify(existing))
        : { id: '', name: '', icon: '✨', color: COLORS[Math.floor(Math.random() * COLORS.length)], properties: [], defaultTemplate: null, order: types.length },
  );
  const [useTemplate, setUseTemplate] = useState(!!existing?.defaultTemplate);
  const template = useRef<JSONContent>(existing?.defaultTemplate ?? emptyDoc());
  const [emoji, setEmoji] = useState(false);
  const iconBtn = useRef<HTMLButtonElement>(null);
  const [err, setErr] = useState('');
  const close = () => setTypeEditor(null);
  const count = existing ? objects.filter((o) => o.typeId === existing.id && !o.deletedAt).length : 0;

  const setProp = (i: number, patch: Partial<PropertyDef>) => setDraft((d) => ({ ...d, properties: d.properties.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
  const move = (i: number, dir: number) =>
    setDraft((d) => {
      const ps = [...d.properties];
      const j = i + dir;
      if (j < 0 || j >= ps.length) return d;
      [ps[i], ps[j]] = [ps[j], ps[i]];
      return { ...d, properties: ps };
    });
  const addProp = () =>
    setDraft((d) => {
      let key = 'field';
      let n = 1;
      while (d.properties.some((p) => p.key === key)) key = `field-${++n}`;
      return { ...d, properties: [...d.properties, { key, name: '', kind: 'text' }] };
    });

  const save = async () => {
    const name = draft.name.trim();
    if (!name) return setErr('Give the type a name.');
    if (types.some((t) => t.id !== existing?.id && t.name.toLowerCase() === name.toLowerCase())) return setErr('A type with this name already exists.');
    const props: PropertyDef[] = [];
    for (const p of draft.properties) {
      const pname = p.name.trim();
      if (!pname) continue;
      // new properties get a key from their name; existing keys stay stable on rename
      const isNew = !existing?.properties.some((x) => x.key === p.key);
      let key = isNew ? slug(pname) : p.key;
      let n = 1;
      while (props.some((x) => x.key === key)) key = `${isNew ? slug(pname) : p.key}-${++n}`;
      props.push({
        key,
        name: pname,
        kind: p.kind,
        ...(p.kind === 'select' ? { options: (p.options ?? []).map((o) => o.trim()).filter(Boolean) } : {}),
        ...(p.kind === 'relation' ? { targetTypeId: p.targetTypeId ?? null, multi: !!p.multi } : {}),
      });
    }
    const id = existing?.id ?? `${slug(name)}-${uid().slice(0, 6)}`;
    const next: ObjType = { ...draft, id, name, properties: props, defaultTemplate: useTemplate ? template.current : null, updatedAt: Date.now() };
    await db.types.put(next);
    if (existing) await reindexAll();
    close();
  };

  const remove = async () => {
    if (!existing || existing.builtin) return;
    const all = objects.filter((o) => o.typeId === existing.id);
    if (!confirm(all.length ? `Delete “${existing.name}”? Its ${all.length} object(s) will be converted to Pages.` : `Delete “${existing.name}”?`)) return;
    for (const o of all) await convertType(o.id, 'page');
    await db.types.delete(existing.id);
    close();
  };

  return (
    <Modal onClose={close} className="type-editor">
      <div className="modal-head">
        <h2>{existing ? `Edit ${existing.name}` : 'New object type'}</h2>
        <button type="button" className="icon-btn" onClick={close}>
          <X size={18} />
        </button>
      </div>
      <div className="modal-body">
        <div className="te-row">
          <button type="button" ref={iconBtn} className="te-icon" style={{ ['--type-color' as any]: draft.color }} onClick={() => setEmoji(true)}>
            {draft.icon}
          </button>
          <input className="te-name" placeholder="Type name, e.g. Recipe" value={draft.name} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        {emoji && (
          <EmojiPicker
            anchor={iconBtn.current}
            allowClear={false}
            onClose={() => setEmoji(false)}
            onPick={(e) => {
              if (e) setDraft({ ...draft, icon: e });
              setEmoji(false);
            }}
          />
        )}
        <div className="te-colors">
          {COLORS.map((c) => (
            <button key={c} type="button" className={`swatch${draft.color === c ? ' active' : ''}`} style={{ background: c }} onClick={() => setDraft({ ...draft, color: c })} aria-label={c} />
          ))}
        </div>

        <h4>Properties</h4>
        {draft.properties.length === 0 && <p className="muted small">No properties yet. Properties show at the top of every {draft.name || 'object'}.</p>}
        <div className="te-props">
          {draft.properties.map((p, i) => (
            <div key={i} className="te-prop">
              <input placeholder="Property name" value={p.name} onChange={(e) => setProp(i, { name: e.target.value })} />
              <select value={p.kind} onChange={(e) => setProp(i, { kind: e.target.value as PropertyKind })}>
                {KINDS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              {p.kind === 'select' && (
                <input
                  className="te-wide"
                  placeholder="Options, comma separated"
                  value={(p.options ?? []).join(', ')}
                  onChange={(e) => setProp(i, { options: e.target.value.split(',').map((x) => x.trimStart()) })}
                />
              )}
              {p.kind === 'relation' && (
                <>
                  <select value={p.targetTypeId ?? ''} onChange={(e) => setProp(i, { targetTypeId: e.target.value || null })}>
                    <option value="">Any type</option>
                    {types
                      .filter((t) => t.id !== 'daily')
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.icon} {t.name}
                        </option>
                      ))}
                  </select>
                  <label className="te-check">
                    <input type="checkbox" checked={!!p.multi} onChange={(e) => setProp(i, { multi: e.target.checked })} /> Multiple
                  </label>
                </>
              )}
              <div className="te-prop-actions">
                <button type="button" className="icon-btn tiny" onClick={() => move(i, -1)} title="Move up">
                  <ArrowUp size={14} />
                </button>
                <button type="button" className="icon-btn tiny" onClick={() => move(i, 1)} title="Move down">
                  <ArrowDown size={14} />
                </button>
                <button type="button" className="icon-btn tiny danger" onClick={() => setDraft((d) => ({ ...d, properties: d.properties.filter((_, j) => j !== i) }))} title="Remove">
                  <Trash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="btn-ghost" onClick={addProp}>
          <Plus size={14} /> Add property
        </button>

        {draft.id !== 'daily' && (
          <>
            <h4>
              <label className="te-check">
                <input type="checkbox" checked={useTemplate} onChange={(e) => setUseTemplate(e.target.checked)} /> Default template
              </label>
            </h4>
            {useTemplate && (
              <div className="te-template">
                <RichEditor
                  docKey={`tpl-${draft.id || 'new'}`}
                  content={template.current}
                  onChange={(j) => (template.current = j)}
                  placeholder="Write the starting content for every new object of this type…"
                />
              </div>
            )}
          </>
        )}
        {err && <div className="banner warn">{err}</div>}
      </div>
      <div className="modal-foot">
        {existing && !existing.builtin && (
          <button type="button" className="btn danger" onClick={remove}>
            <Trash size={14} /> Delete type{count ? ` (${count})` : ''}
          </button>
        )}
        <div className="spacer" />
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={save}>
          {existing ? 'Save' : 'Create type'}
        </button>
      </div>
    </Modal>
  );
}
