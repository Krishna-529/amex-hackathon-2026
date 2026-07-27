/**
 * One place to configure how the three sites are addressed.
 *
 * Local  → three dev servers on three ports, BrowserRouter, base "/".
 * Pages  → one GitHub Pages site, the three apps under sub-paths,
 *          HashRouter, base "/<repo>/<app>/".
 *
 * Why HashRouter for Pages: GitHub Pages has no server-side rewrite, so a
 * client route like /proof/sens-portfolio has no file behind it and returns 404.
 * The usual workaround is a 404.html that re-encodes the path — but Pages serves
 * only the ROOT 404.html, which cannot cleanly disambiguate three sub-apps. A
 * hash route needs no rewrite at all and cannot break. Ugly URL, zero fragility.
 */

// ── EDIT THIS to your GitHub repository name ────────────────────────────────
export const REPO = 'zkd-concierge';
// ────────────────────────────────────────────────────────────────────────────

export const APPS = [
  { key: 'design', port: 5173, label: 'System design' },
  { key: 'metrics', port: 5174, label: 'Success metrics' },
  { key: 'personas', port: 5175, label: 'Personas' },
];

export const isPages = () => process.env.DEPLOY_TARGET === 'pages';

/* Vercel deploys each app as its own project on its own domain, so neither the
   local port scheme nor the Pages sub-path scheme addresses a sibling site
   correctly. Vercel sets VERCEL=1 during a build, so this needs no project
   configuration. Keep the keys in step with APPS above. */
export const isVercel = () => process.env.DEPLOY_TARGET === 'vercel' || Boolean(process.env.VERCEL);

export const VERCEL_URLS = {
  design: 'https://zkd-design.vercel.app/',
  metrics: 'https://zkd-metrics.vercel.app/',
  personas: 'https://zkd-personas.vercel.app/',
};

/** Absolute sibling-site URLs when they are known at build time, else null. */
export const siteUrls = () => (isVercel() ? VERCEL_URLS : null);

/** Vite `base` for a given app. Vercel serves each project at its own root. */
export const baseFor = (app) => (isPages() ? `/${REPO}/${app}/` : '/');
