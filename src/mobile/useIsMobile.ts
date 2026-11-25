import { useSyncExternalStore } from 'react';

/** Phones and narrow windows get the mobile layout; the same width the sidebar already folds away at. */
export const MOBILE_QUERY = '(max-width: 820px)';

const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null;

const subscribe = (fn: () => void) => {
  query?.addEventListener('change', fn);
  return () => query?.removeEventListener('change', fn);
};

export const isMobileNow = () => !!query?.matches;

export function useIsMobile() {
  return useSyncExternalStore(subscribe, isMobileNow, () => false);
}
