import { typeLabel } from '../lib/typeLabels';
import { isComposing } from '../lib/keyboard';
import { useT } from '../store/uiStore';
import { useState } from 'react';
import type { ObjType } from '../db/schema';
import { Popover } from './Popover';

export function TypeIcon({ type, size = 'md' }: { type?: ObjType | null; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`type-icon type-icon-${size}`} style={{ ['--type-color' as any]: type?.color ?? '#8b8a86' }}>
      {type?.icon ?? '📄'}
    </span>
  );
}

export function TypeBadge({ type, onClick }: { type?: ObjType | null; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  const tr = useT();
  return (
    <button type="button" className="type-badge" style={{ ['--type-color' as any]: type?.color ?? '#8b8a86' }} onClick={onClick}>
      <span>{type?.icon}</span>
      {typeLabel(type ?? undefined, tr)}
    </button>
  );
}

const EMOJIS = (
  '📄 📝 📌 📎 📚 📖 🔖 💡 ✨ 🚀 🎯 ✅ 🗓️ 📅 ⏰ 🧠 💭 🗂️ 📁 🏷️ 🔗 🧩 🛠️ ⚙️ 💻 📱 🖥️ 🎨 🎵 🎬 📷 🌱 🌿 🌍 🏠 🏢 ✈️ 🍳 ☕ 🍎 💪 🧘 🏃 ❤️ 💛 💚 💙 💜 🖤 ⭐ 🔥 ⚡ 🌙 ☀️ 🌈 🎁 💰 💳 📈 📊 🧾 🛒 🧑 👩 👨 👥 🤝 🗣️ 🎓 🏆 🔒 🧪 🐞'
).split(' ');

export function EmojiPicker({ anchor, onPick, onClose, allowClear = true }: { anchor: HTMLElement | null; onPick: (e: string | null) => void; onClose: () => void; allowClear?: boolean }) {
  const tr = useT();
  const [custom, setCustom] = useState('');
  return (
    <Popover anchor={anchor} onClose={onClose} className="emoji-picker">
      <div className="emoji-grid">
        {EMOJIS.map((e) => (
          <button key={e} type="button" onClick={() => onPick(e)}>
            {e}
          </button>
        ))}
      </div>
      <div className="emoji-foot">
        <input
          placeholder={tr('Paste any emoji')}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !isComposing(e.nativeEvent) && custom.trim() && onPick([...custom.trim()][0] ?? null)}
        />
        {allowClear && (
          <button type="button" className="btn-ghost" onClick={() => onPick(null)}>
            {tr('Reset')}
          </button>
        )}
      </div>
    </Popover>
  );
}
