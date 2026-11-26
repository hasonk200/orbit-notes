import { create } from 'zustand';
import { resolveLanguage, translators, type Language } from '../lib/i18n';
import type { Space } from '../db/schema';

export type Theme = 'light' | 'dark' | 'system';

function readTheme(): Theme {
  try {
    const t = typeof window === 'undefined' ? null : window.localStorage.getItem('orbit-theme');
    if (t === 'light' || t === 'dark' || t === 'system') return t;
  } catch {
    /* ignore */
  }
  return 'system';
}

function readLanguage(): Language {
  const preferred = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language];
  try {
    const saved = typeof window === 'undefined' ? null : window.localStorage.getItem('orbit-language');
    return resolveLanguage(saved, preferred);
  } catch {
    return resolveLanguage(null, preferred);
  }
}

/** The space you are in is remembered on this device only. */
function readSpace(): Space {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('orbit-space') === 'ai' ? 'ai' : 'me';
  } catch {
    return 'me';
  }
}

/** The AI workspace has its own accent colour, so you can tell at a glance where you are. */
export function applySpace(space: Space) {
  const root = document.documentElement;
  if (space === 'ai') root.setAttribute('data-space', 'ai');
  else root.removeAttribute('data-space');
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
}

interface SplitState {
  stack: string[];
  idx: number;
}

interface UIState {
  sidebarOpen: boolean;
  paletteOpen: boolean;
  theme: Theme;
  language: Language;
  space: Space;
  split: SplitState | null;
  typeEditor: string | null; // type id, or 'new'
  newMenuOpen: boolean;
  mainPath: string;
  mainGo: ((path: string) => void) | null;
  toggleSidebar: () => void;
  setSidebar: (v: boolean) => void;
  setPalette: (v: boolean) => void;
  setTheme: (t: Theme) => void;
  setLanguage: (language: Language) => void;
  setSpace: (space: Space) => void;
  openSplit: (path: string) => void;
  splitGo: (path: string) => void;
  splitReplace: (path: string) => void;
  splitBack: () => void;
  splitForward: () => void;
  closeSplit: () => void;
  setTypeEditor: (id: string | null) => void;
  setNewMenu: (v: boolean) => void;
}

const narrow = () => typeof window !== 'undefined' && window.innerWidth < 820;

export const useUI = create<UIState>((set, get) => ({
  sidebarOpen: !narrow(),
  paletteOpen: false,
  theme: readTheme(),
  language: readLanguage(),
  space: readSpace(),
  split: null,
  typeEditor: null,
  newMenuOpen: false,
  mainPath: '/',
  mainGo: null,
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  setSidebar: (v) => set({ sidebarOpen: v }),
  setPalette: (v) => set({ paletteOpen: v }),
  setTheme: (t) => {
    try {
      localStorage.setItem('orbit-theme', t);
    } catch {
      /* ignore */
    }
    applyTheme(t);
    set({ theme: t });
  },
  setLanguage: (language) => {
    try {
      localStorage.setItem('orbit-language', language);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = language;
    set({ language });
  },
  setSpace: (space) => {
    try {
      if (space === 'ai') localStorage.setItem('orbit-space', 'ai');
      else localStorage.removeItem('orbit-space');
    } catch {
      /* ignore */
    }
    applySpace(space);
    set({ space });
  },
  openSplit: (path) => {
    const s = get().split;
    if (!s) set({ split: { stack: [path], idx: 0 } });
    else get().splitGo(path);
  },
  splitGo: (path) => {
    const s = get().split ?? { stack: [], idx: -1 };
    const stack = [...s.stack.slice(0, s.idx + 1), path];
    set({ split: { stack, idx: stack.length - 1 } });
  },
  splitReplace: (path) => {
    const s = get().split;
    if (!s) return;
    const stack = [...s.stack];
    stack[s.idx] = path;
    set({ split: { ...s, stack } });
  },
  splitBack: () => {
    const s = get().split;
    if (s && s.idx > 0) set({ split: { ...s, idx: s.idx - 1 } });
  },
  splitForward: () => {
    const s = get().split;
    if (s && s.idx < s.stack.length - 1) set({ split: { ...s, idx: s.idx + 1 } });
  },
  closeSplit: () => set({ split: null }),
  setTypeEditor: (id) => set({ typeEditor: id }),
  setNewMenu: (v) => set({ newMenuOpen: v }),
}));

export const useT = () => useUI((state) => translators[state.language]);
export const useCurrentSpace = () => useUI((state) => state.space);
export const getT = () => translators[useUI.getState().language];
