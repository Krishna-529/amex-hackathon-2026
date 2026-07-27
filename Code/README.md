# Autonomous Travel-Disruption Concierge — Team ZKD

Codestreet 2026 · American Express · Round 1
M. Zayaan · Krishna Satyam · Dhawal Khatri — IIT Madras

Three sites:

| | Site | What it covers |
|---|---|---|
| 01 | **System design** | Architecture, scalability argued from arithmetic, feasibility rated per dependency |
| 02 | **Success metrics** | A 250,000-case Monte Carlo, sensitivity sweep, assumptions register, sources |
| 03 | **Personas** | Four recovery scenarios across the consent spectrum |

Every figure carries a provenance badge — **VERIFIED** (external source, linked),
**CALC / SIM** (formula shown, reproducible), **ASSUMED / BUDGET** (our input, not a
measurement) — and links to its own proof page showing the derivation and sources.

---

## Run it locally

```bash
npm install
npm run dev
```

- System design → http://localhost:5173
- Success metrics → http://localhost:5174
- Personas → http://localhost:5175

Servers bind to `0.0.0.0`, so other devices on the same network can reach them at
`http://<your-lan-ip>:5173`. Windows Firewall may need to allow Node on private
networks the first time.

Production build, served from one zero-dependency host:

```bash
npm run build
node "../ZKD Website/serve.js"
```

## Deploy to GitHub Pages

1. **Set the repo name.** Open `deploy.config.js` and change `REPO` to match your
   repository. Everything derives from that one constant.

2. **Create the repository and push.**

   ```bash
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main
   ```

3. **Turn Pages on.** Repository → Settings → Pages → **Source: GitHub Actions**.
   Do not pick "Deploy from a branch" — the workflow publishes an artifact.

4. Every push to `main` builds and deploys. Result:

   ```
   https://<user>.github.io/<repo>/            landing
   https://<user>.github.io/<repo>/design/
   https://<user>.github.io/<repo>/metrics/
   https://<user>.github.io/<repo>/personas/
   ```

No secrets to configure — the workflow uses the default `GITHUB_TOKEN`.

### Why the Pages build uses hash routes

Proof pages live at `/proof/:id` and are client-routed, so there is no file on
disk behind them. Locally `serve.js` rewrites extensionless paths to
`index.html`. GitHub Pages has no server-side rewrite, and it serves only the
**root** `404.html` — which cannot cleanly disambiguate three sub-apps.

So the Pages build switches to `HashRouter` (`/repo/metrics/#/proof/xyz`). Uglier
URL, but it needs no rewrite and cannot break. The switch happens at build time
via `DEPLOY_TARGET=pages`; local builds keep clean paths.

---

## Layout

```
apps/design      → :5173   architecture, scalability, feasibility
apps/metrics     → :5174   the research
apps/personas    → :5175   four scenarios
packages/shared          tokens, proof registry, simulation data, components
public/index.html        landing page, published at the Pages root
deploy.config.js         repo name + local-vs-Pages switch
.github/workflows        build and deploy
```

`packages/shared/data/proofs.js` is the single source of truth for every number.
A `ProofLink` with an unknown id renders a visible marker rather than failing
silently.

## Reproducing the simulation

`iropssim.py` sits alongside this repo in the project folder.

```bash
python iropssim.py
```

Seed `20260726`, N = 250,000 across 39,301 events. No clock or network input, so
the run is deterministic — the numbers in the metrics site reproduce exactly.
The full parameter set is printed in the assumptions register.

## What is not built

This is a design and its evidence, not a running system. The simulation is a
model with declared assumptions; the architecture exists as diagrams and rules.
Where a supplier capability is assumed rather than verified — group allotments,
hold availability per fare — the site says so.
