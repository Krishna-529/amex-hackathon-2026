import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseFor, isPages, REPO, APPS, siteUrls } from '../../deploy.config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const shared = path.resolve(here, '../../packages/shared');
const repoRoot = path.resolve(here, '../..');

const APP = 'personas';

export default defineConfig({
  base: baseFor(APP),
  plugins: [react()],
  resolve: { alias: { '@shared': shared } },
  define: {
    // build-time constants the shared components read
    __ZKD_PAGES__: JSON.stringify(isPages()),
    __ZKD_REPO__: JSON.stringify(REPO),
    __ZKD_APP__: JSON.stringify(APP),
    __ZKD_APPS__: JSON.stringify(APPS),
    __ZKD_SITE_URLS__: JSON.stringify(siteUrls()),
  },
  server: { host: true, port: 5175, strictPort: true, fs: { allow: [here, shared, repoRoot] } },
  preview: { host: true, port: 5175, strictPort: true },
});
