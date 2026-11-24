import { defineConfig } from 'vite';
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

export default defineConfig({
  // GitHub Pages serves the app under /orbit-notes/
  base: process.env.GITHUB_PAGES ? '/orbit-notes/' : '/',
  plugins: [react()],
  server: { port: 5175 },
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
});
