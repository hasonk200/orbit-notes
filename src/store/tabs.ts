/**
 * Tabs for the main pane on desktop. Each tab keeps its own back/forward history; the router's URL
 * always mirrors the active tab (App.tsx keeps the two in step). Remembered across restarts.
 */
import { create } from 'zustand';

export interface Tab {
  id: string;
  stack: string[];
  idx: number;
}

interface TabsState {
  tabs: Tab[];
  active: string;
}

const KEY = 'orbit-tabs';
const MAX_TABS = 20;
const MAX_HISTORY = 50;
export const NEW_TAB_PATH = '/home';

const newId = () => Math.random().toString(36).slice(2, 10);
const fresh = (path: string): Tab => ({ id: newId(), stack: [path], idx: 0 });

function load(): TabsState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as TabsState | null;
    const tabs = saved?.tabs?.filter((t) => Array.isArray(t.stack) && t.stack.length && typeof t.stack[t.idx] === 'string');
    if (tabs?.length) return { tabs, active: tabs.some((t) => t.id === saved!.active) ? saved!.active : tabs[0].id };
  } catch {
    /* ignore */
  }
  const first = fresh('/');
  return { tabs: [first], active: first.id };
}

export const useTabs = create<TabsState>(load);

useTabs.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
});

export const tabPath = (t: Tab) => t.stack[t.idx];
export const activeTab = (s: TabsState = useTabs.getState()) => s.tabs.find((t) => t.id === s.active) ?? s.tabs[0];

function updateActive(fn: (t: Tab) => Tab) {
  useTabs.setState((s) => ({ tabs: s.tabs.map((t) => (t.id === s.active ? fn(t) : t)) }));
}

/** Open a page in the active tab (adds to its history). */
export function tabGo(path: string) {
  updateActive((t) => {
    if (tabPath(t) === path) return t;
    const stack = [...t.stack.slice(0, t.idx + 1), path].slice(-MAX_HISTORY);
    return { ...t, stack, idx: stack.length - 1 };
  });
}

export function tabReplace(path: string) {
  updateActive((t) => {
    const stack = [...t.stack];
    stack[t.idx] = path;
    return { ...t, stack };
  });
}

export const tabBack = () => updateActive((t) => (t.idx > 0 ? { ...t, idx: t.idx - 1 } : t));
export const tabForward = () => updateActive((t) => (t.idx < t.stack.length - 1 ? { ...t, idx: t.idx + 1 } : t));

/** A new tab next to the active one. Background tabs (Ctrl+click) don't take focus. */
export function openTab(path = NEW_TAB_PATH, focus = true) {
  useTabs.setState((s) => {
    if (s.tabs.length >= MAX_TABS) {
      // Full: reuse the active tab rather than silently doing nothing.
      return { tabs: s.tabs.map((t) => (t.id === s.active ? { ...t, stack: [...t.stack.slice(0, t.idx + 1), path], idx: t.idx + 1 } : t)) };
    }
    const tab = fresh(path);
    const at = s.tabs.findIndex((t) => t.id === s.active) + 1;
    const tabs = [...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)];
    return { tabs, active: focus ? tab.id : s.active };
  });
}

/** Close a tab; the neighbour on the right (or left) takes over. The last tab goes back to a new-tab page instead. */
export function closeTab(id: string) {
  useTabs.setState((s) => {
    if (s.tabs.length === 1) {
      const t = fresh(NEW_TAB_PATH);
      return { tabs: [t], active: t.id };
    }
    const i = s.tabs.findIndex((t) => t.id === id);
    if (i < 0) return s;
    const tabs = s.tabs.filter((t) => t.id !== id);
    const active = s.active === id ? tabs[Math.min(i, tabs.length - 1)].id : s.active;
    return { tabs, active };
  });
}

export const activateTab = (id: string) => useTabs.setState({ active: id });

/** Ctrl+Tab / Ctrl+Shift+Tab, and Ctrl+1…9 (9 = last). */
export function cycleTab(dir: 1 | -1) {
  const s = useTabs.getState();
  const i = s.tabs.findIndex((t) => t.id === s.active);
  activateTab(s.tabs[(i + dir + s.tabs.length) % s.tabs.length].id);
}
export function activateTabAt(n: number) {
  const { tabs } = useTabs.getState();
  const t = n >= 9 ? tabs[tabs.length - 1] : tabs[n - 1];
  if (t) activateTab(t.id);
}
