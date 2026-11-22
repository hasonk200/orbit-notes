// Build for GitHub Pages and publish dist/ to the gh-pages branch.
// Usage: npm run deploy   (needs .env.local with your Firebase config)
import { execSync } from 'node:child_process';
import { copyFileSync, writeFileSync, rmSync } from 'node:fs';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
run('npx vite build', { env: { ...process.env, GITHUB_PAGES: 'true' } });
copyFileSync('dist/index.html', 'dist/404.html'); // deep links like /orbit-notes/tasks
writeFileSync('dist/.nojekyll', '');
const remote = execSync('git remote get-url origin').toString().trim();
rmSync('dist/.git', { recursive: true, force: true });
run('git init -q -b gh-pages', { cwd: 'dist' });
run('git add -A', { cwd: 'dist' });
run('git commit -q -m "Deploy Orbit to GitHub Pages"', { cwd: 'dist' });
run(`git push -q -f ${remote} gh-pages`, { cwd: 'dist' });
rmSync('dist/.git', { recursive: true, force: true });
console.log('Deployed: https://hasonk200.github.io/orbit-notes/');
