import { typeLabel } from '../lib/typeLabels';
import { normalizeText } from '../lib/search';
import { normalizeTagName } from '../lib/supertags';
import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash, X } from 'lucide-react';
import { db, uid, type JSONContent, type ObjType, type PropertyDef, type PropertyKind } from '../db/schema';
import { convertType, reindexAll } from '../db/indexers';
import { useData } from '../store/dataStore';
import { useT, useUI } from '../store/uiStore';
import { RichEditor } from '../editor/Editor';
import { emptyDoc } from '../lib/content';
import { EmojiPicker } from './TypeIcon';
import { Modal } from './Popover';
import { MenuSelect } from './MenuSelect';

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
  const tr = useT();
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
    if (!name) return setErr(tr('Give the type a name.'));
    if (types.some((t) => t.id !== existing?.id && [t.name, typeLabel(t, tr)].some((label) => normalizeText(label) === normalizeText(name)))) return setErr(tr('A type with this name already exists.'));
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
    const tag = normalizeTagName(draft.tag ?? '') || null;
    if (tag && types.some((t) => t.id !== existing?.id && t.tag === tag)) return setErr(tr('Another type already uses #{tag}.', { tag }));
    const id = existing?.id ?? `${slug(name)}-${uid().slice(0, 6)}`;
    const next: ObjType = { ...draft, id, name, tag, properties: props, defaultTemplate: useTemplate ? template.current : null, updatedAt: Date.now() };
    await db.types.put(next);
    if (existing) await reindexAll();
    close();
  };

  const remove = async () => {
    if (!existing || existing.builtin) return;
    const all = objects.filter((o) => o.typeId === existing.id);
    const name = typeLabel(existing, tr);
    if (!confirm(all.length ? tr('Delete “{name}”? Its {count} object(s) will be converted to Pages.', { name, count: all.length }) : tr('Delete “{name}”?', { name }))) return;
    for (const o of all) await convertType(o.id, 'page');
    await db.types.delete(existing.id);
    close();
  };

  return (
    <Modal onClose={close} className="type-editor" label={existing ? tr("Edit {type}", { type: typeLabel(existing, tr) }) : tr('New object type')}>
      <div className="modal-head">
        <h2>{existing ? tr('Edit {type}', { type: typeLabel(existing, tr) }) : tr('New object type')}</h2>
        <button type="button" className="icon-btn" onClick={close}>
          <X size={18} />
        </button>
      </div>
      <div className="modal-body">
        <div className="te-row">
          <button type="button" ref={iconBtn} className="te-icon" style={{ ['--type-color' as any]: draft.color }} onClick={() => setEmoji(true)}>
            {draft.icon}
          </button>
          <input className="te-name" placeholder={tr('Type name, e.g. Recipe')} value={draft.name} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
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

        {draft.id !== 'daily' && (
          <label className="te-supertag">
            <span className="te-supertag-label">{tr('Supertag')}</span>
            <span className="te-supertag-input">
              #
              <input placeholder={tr('e.g. bill')} value={draft.tag ?? ''} onChange={(e) => setDraft({ ...draft, tag: e.target.value })} />
            </span>
            <span className="muted small">{tr('Any bullet or to-do with this tag shows the properties below as fields.')}</span>
          </label>
        )}

        <h4>{tr('Properties')}</h4>
        {draft.properties.length === 0 && <p className="muted small">{tr('No properties yet. Properties show at the top of every {type}.', { type: draft.name || tr('object') })}</p>}
        <div className="te-props">
          {draft.properties.map((p, i) => (
            <div key={i} className="te-prop">
              <input placeholder={tr('Property name')} value={p.name} onChange={(e) => setProp(i, { name: e.target.value })} />
              <MenuSelect
                look="field"
                className="te-prop-select"
                label={tr('Property type')}
                value={p.kind}
                onChange={(kind) => setProp(i, { kind })}
                options={KINDS.map(([k, l]) => ({ value: k, label: tr(l) }))}
              />
              {p.kind === 'select' && (
                <input
                  className="te-wide"
                  placeholder={tr('Options, comma separated')}
                  value={(p.options ?? []).join(', ')}
                  onChange={(e) => setProp(i, { options: e.target.value.split(/[,，]/).map((x) => x.trimStart()) })}
                />
              )}
              {p.kind === 'relation' && (
                <>
                  <MenuSelect
                    look="field"
                    className="te-prop-select"
                    label={tr('Links to')}
                    value={p.targetTypeId ?? ''}
                    onChange={(v) => setProp(i, { targetTypeId: v || null })}
                    options={[
                      { value: '', label: tr('Any type') },
                      ...types.filter((t) => t.id !== 'daily').map((t) => ({ value: t.id, label: `${t.icon} ${typeLabel(t, tr)}` })),
                    ]}
                  />
                  <label className="te-check">
                    <input type="checkbox" checked={!!p.multi} onChange={(e) => setProp(i, { multi: e.target.checked })} /> {tr('Multiple')}
                  </label>
                </>
              )}
              <div className="te-prop-actions">
                <button type="button" className="icon-btn tiny" onClick={() => move(i, -1)} title={tr('Move up')}>
                  <ArrowUp size={14} />
                </button>
                <button type="button" className="icon-btn tiny" onClick={() => move(i, 1)} title={tr('Move down')}>
                  <ArrowDown size={14} />
                </button>
                <button type="button" className="icon-btn tiny danger" onClick={() => setDraft((d) => ({ ...d, properties: d.properties.filter((_, j) => j !== i) }))} title={tr('Remove')}>
                  <Trash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="btn-ghost" onClick={addProp}>
          <Plus size={14} /> {tr('Add property')}
        </button>

        {draft.id !== 'daily' && (
          <>
            <h4>
              <label className="te-check">
                <input type="checkbox" checked={useTemplate} onChange={(e) => setUseTemplate(e.target.checked)} /> {tr('Default template')}
              </label>
            </h4>
            {useTemplate && (
              <div className="te-template">
                <RichEditor
                  docKey={`tpl-${draft.id || 'new'}`}
                  content={template.current}
                  onChange={(j) => (template.current = j)}
                  showGutter={false}
                  placeholder={tr('Write the starting content for every new object of this type…')}
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
            <Trash size={14} /> {tr('Delete type')}{count ? ` (${count})` : ''}
          </button>
        )}
        <div className="spacer" />
        <button type="button" className="btn" onClick={close}>
          {tr('Cancel')}
        </button>
        <button type="button" className="btn primary" onClick={save}>
          {existing ? tr('Save') : tr('Create type')}
        </button>
      </div>
    </Modal>
  );
}
