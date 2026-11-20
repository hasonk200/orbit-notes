import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';

function readTheme(): Theme {
  try {
    const t = localStorage.getItem('orbit-theme');
    if (t === 'light' || t === 'dark' || t === 'system') return t;
  } catch {
    /* ignore */
  }
  return 'system';
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
  split: SplitState | null;
  typeEditor: string | null; // type id, or 'new'
  newMenuOpen: boolean;
  mainPath: string;
  mainGo: ((path: string) => void) | null;
  toggleSidebar: () => void;
  setSidebar: (v: boolean) => void;
  setPalette: (v: boolean) => void;
  setTheme: (t: Theme) => void;
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
