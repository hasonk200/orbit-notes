import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
// Each automatic deploy gets its own patch number (major.minor come from package.json),
// so the version in the sidebar goes up every time a pull request is merged.
const build = process.env.ORBIT_BUILD_NUMBER;
const version = build && /^\d+$/.test(build) ? pkg.version.replace(/^(\d+\.\d+)\.\d+.*$/, `$1.${build}`) : pkg.version;
let commit = '';
try { commit = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* not a git checkout */ }

/**
 * The built stylesheet would hold up the first paint until it downloads. The splash has its own
 * inline styles, so load the stylesheet in the background (main.tsx keeps the splash up until it is in).
 */
function nonBlockingCss(): Plugin {
  return {
    name: 'orbit-non-blocking-css',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html.replace(/<link rel="stylesheet"([^>]*?)href="([^"]+\.css)"([^>]*)>/g, '<link rel="stylesheet"$1href="$2"$3 data-orbit-css media="print" onload="this.media=\'all\'">'),
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the app under /orbit-notes/
  base: process.env.GITHUB_PAGES ? '/orbit-notes/' : '/',
  plugins: [react(), nonBlockingCss()],
  server: { port: 5175 },
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
});
