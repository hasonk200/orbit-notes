import { useId } from 'react';

/** Orbit's planet-and-ring mark. Ids are unique per instance so several logos can share a page. */
export function OrbitLogo({ size = 20 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  const front = `${id}-front`;
  const gap = `${id}-gap`;
  const gold = `${id}-gold`;
  const planet = `${id}-planet`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <clipPath id={front}>
          <rect x="0" y="16" width="32" height="16" />
        </clipPath>
        {/* cut a thin gap in the planet where the front of the gold ring passes over it */}
        <mask id={gap} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
          <rect width="32" height="32" fill="#fff" />
          <ellipse cx="16" cy="16" rx="14" ry="5.2" fill="none" stroke="#000" strokeWidth="5" clipPath={`url(#${front})`} />
        </mask>
        <linearGradient id={gold} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset=".4" stopColor="#f2c14e" />
          <stop offset=".75" stopColor="#c8901c" />
          <stop offset="1" stopColor="#8a5a0b" />
        </linearGradient>
        <radialGradient id={planet} cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor="#a79dff" />
          <stop offset=".6" stopColor="#6d5efc" />
          <stop offset="1" stopColor="#4a3bd6" />
        </radialGradient>
      </defs>
      <g transform="rotate(-22 16 16)">
        <ellipse cx="16" cy="16" rx="14" ry="5.2" fill="none" stroke={`url(#${gold})`} strokeWidth="2.8" />
        <circle cx="16" cy="16" r="8" fill={`url(#${planet})`} mask={`url(#${gap})`} />
        <g clipPath={`url(#${front})`}>
          <ellipse cx="16" cy="16" rx="14" ry="5.2" fill="none" stroke={`url(#${gold})`} strokeWidth="2.8" />
          <ellipse cx="16" cy="16" rx="14" ry="5.2" fill="none" stroke="#fffbe8" strokeOpacity=".9" strokeWidth=".6" transform="translate(0 -.75)" />
        </g>
      </g>
    </svg>
  );
}
