import { realpathSync } from 'node:fs';
import { defineConfig, loadConfigFromFile, mergeConfig, searchForWorkspaceRoot } from 'vite';

/**
 * The app's own Vite config (vite.config.ts), used by the end-to-end server with two additions:
 * - the dev server may also read files from where node_modules really lives. In a git worktree node_modules
 *   is often a link to the main checkout, outside the project folder, and Vite would refuse to serve the
 *   fonts and the PDF.js worker;
 * - every screen is transformed when the server starts, so the first test to open one does not wait for it;
 * - its own dependency cache: `npm run dev` may be running at the same time, and two servers re-optimizing the
 *   same node_modules/.vite would swap files under each other (screens stuck on "Abrindo…").
 */
export default defineConfig(async env => {
  const app = await loadConfigFromFile(env, 'vite.config.ts');
  if (!app) throw new Error('vite.config.ts not found.');
  return mergeConfig(app.config, {
    cacheDir: 'node_modules/.vite-e2e',
    server: {
      fs: { allow: [searchForWorkspaceRoot(process.cwd()), realpathSync('node_modules')] },
      warmup: { clientFiles: ['./src/**/*.{ts,tsx}'] },
    },
  });
});
