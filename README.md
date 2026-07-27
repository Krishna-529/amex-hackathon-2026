# ZKD Concierge — Codestreet 2026 / American Express

Team ZKD, IIT Madras. Autonomous travel-disruption concierge for Indian domestic aviation:
predict or detect an IRROPS event, re-accommodate the member across flight + hotel + ground,
claim duty of care from the carrier, and stop safely when it cannot.

## ⚠️ The implementation is not in this repository

`Code/` and `zkd-sites/` were committed as **git submodules** (gitlinks → commit `49e78886…`)
with **no `.gitmodules`**, so `git submodule update --init` could never resolve them and a clone
produced two empty directories. The gitlinks have been removed from the index because they were
inert; **the source they pointed at still needs to be added.**

Whoever holds it: either commit the source directly, or re-add it as a submodule *with* a
`.gitmodules` entry. The referenced commit is not reachable from here, so the URL could not be
recovered and has deliberately not been guessed.

## What is here

| Path | What it is |
|---|---|
| `zkd_*_agent_v2.0.md` | **Current.** Four agent specs — Supervisor/Negotiator, Flight Reshop, Hotel Re-accommodation, Ground Transfer. Each is Part A (a prompt that writes the design-doc section) + Part B (the runtime LangGraph system prompt). |
| `zkd_*_agent_v1.0.md` | **Superseded.** Kept for provenance only; each carries a banner saying so. |
| `ZKD-Architecture-Validation-Plan.md` | The 13-finding review of the Round 1 deck. Partially superseded — see its banner. |
| `iropssim.py` → `iropssim-output.json` | 250,000-case Monte Carlo behind every `sim`-tier number. Fixed seed; `python3 iropssim.py` reproduces the JSON byte-for-byte. |
| `ZKD Website/` | Production builds of the three sites + `serve.js` (zero-dependency host). |
| `ZKD Sites/` | Windows launcher + shortcuts for the above. |
| `Amex-workflows.pdf`, `amex-goat-components-2-3.html` | Round 1 supporting artifacts. |

## The canon block is byte-identical across four files — keep it that way

`## A2. FROZEN ARCHITECTURAL FACTS` is asserted identical in all four `*_v2.0.md` files. It is,
today. Verify after any edit:

```sh
python3 - <<'PY'
import hashlib, pathlib
for f in pathlib.Path('.').glob('zkd_*_v2.0.md'):
    t = f.read_text(encoding='utf-8')
    b = t[t.index('## A2. FROZEN'):t.index('## A3.')]
    print(hashlib.sha256(b.encode()).hexdigest()[:16], len(b), f.name)
PY
```

All four hashes must match. Never hand-edit one copy — apply one scripted change-set to all four.

## Running the sites

```sh
cd "ZKD Website" && node serve.js     # ports 5173 / 5174 / 5175
```

Windows: double-click `ZKD Sites\Start ZKD Sites.cmd`.

The servers bind `0.0.0.0` so a phone on the same Wi-Fi can reach them. That is intentional for a
demo on your own network — **do not run them on conference or public Wi-Fi.**

## Reproducing the numbers

```sh
python3 iropssim.py | diff - iropssim-output.json    # must be empty
```

Read `breadth_vs_allocation` in the output before quoting the recovery levers: the headline
"portfolio" figure is **two** mechanisms, and the larger one is simply searching more than one
alternative flight. `closed_without_human_pct` is the `p_intrinsically_complex` assumption restated,
not a model finding — the sensitivity table now shows this directly.
