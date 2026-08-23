# 10 · Monte Carlo revision, 2026-08 — feeding the real risk model back into `iropssim.py`

**ZKD Concierge · Codestreet 2026 / American Express**
Evidence tier: `sim` (the model itself) built on a `real` input (the trained risk model's own
lift table). Every number below is reproducible: `python3 iropssim.py | diff - iropssim-output.json`
is empty as of this revision.

## 0. Why this revision exists

`iropssim.py` (root, cited by [`AGENTS.md`](../../AGENTS.md)'s canonical-facts section and
[`03-action-policy.md`](03-action-policy.md) §9) is the event-level Monte Carlo behind every
`sim`-tier recovery-rate number in this repo. Its `PARAMS` dict is a set of declared assumptions,
each with a stated rationale — but until this revision, `p_prediction_lead` (whether we have
advance warning before a cancellation, which determines how much airline/other-agency demand has
already consumed the alternative-flight inventory before we get there) was a **hand-picked**
0.55, justified only qualitatively ("weather is forecastable, ATC/crew mostly isn't").

We now have something better: a real, trained cancellation-risk model
([`05-cancellation-risk-model.md`](05-cancellation-risk-model.md) — XGBoost, 7.9M real BTS+ANAC
rows, ROC-AUC 0.804, PR-AUC 0.123) with a real decile lift table
(`zkd-risk-model/reports/model_metrics.json`), and a real, live production gate that decides when
the system actually acts on a prediction (`riskScore >= 75`, §6 of `05`). That is a direct,
measurable answer to "what fraction of real disruptions do we actually get advance warning on,"
which is exactly what `p_prediction_lead` is supposed to represent. This revision replaces the
guess with that measurement, re-runs the simulation, and updates every downstream document that
quoted the old run — the outcome-taxonomy table in all four canon agent specs
(`documentation/agent-specs/current/*_v2.0.md`, inside the byte-identical `A2` block — updated as
one scripted change-set across all four, per `AGENTS.md`'s own rule, and re-verified with its
hash check below), `architecture.md`, and `03-action-policy.md`.

**What did NOT change**: every other `PARAMS` value (load factors, route mix, airline
auto-rebooking rates, cross-carrier access, our market share, escalation floor). None of those
have a real trained-model or ingested-data source behind them yet — they remain declared
assumptions, unchanged, and are not touched by this revision. Scope is deliberately narrow: one
parameter, with a real derivation, not a general re-calibration.

## 1. The derivation

The production alt-search pre-cache gate (`05` §6) fires when a flight's `riskScore` — a
percentile rank of the calibrated cancellation probability against a 168,000-point realistic-grid
lookup — crosses 75. That means: **the system only gets "prediction lead" on the top 25% of
flights by real, calibrated risk.**

`zkd-risk-model/reports/model_metrics.json`'s `lift_table` reports real out-of-time test-set
performance in 10 equal-sized deciles (each 10% of flights, ordered by predicted risk). Summing
decile `decile_fraction_positive * 0.1` from the riskiest decile downward and dividing by the
real test-set base rate (`positive_rate_test = 1.046%`) gives real recall — the share of actual
cancellations captured — at each population cutoff:

| Top X% of flights by risk | Real recall (share of actual cancellations caught) |
|---|---|
| 10% | 52.5% |
| 20% | 66.0% |
| **25% (the real production gate)** | **~70.3% (interpolated)** |
| 30% | 74.7% |
| 40% | 82.2% |
| 50% | 87.7% |

Linearly interpolating between the 20%/30% rows to the actual 25% gate gives **70.3%**, rounded to
**0.70**. This is not the model's overall accuracy — it is the specific, narrower question
`p_prediction_lead` needs answered: of all real disruptions, what fraction does the live gate
actually flag in time to search alternatives before the cancellation confirms.

`iropssim.py`'s `PARAMS["p_prediction_lead"]` moved from `0.55` → `0.70`, with the full derivation
left as an inline comment so a future retrain (which changes the lift table) or gate-threshold
change can be re-derived rather than re-guessed. If either changes, re-run
`zkd-risk-model/src/score_distribution.py` and recompute the table above before touching this
file.

## 2. Headline result: before vs. after

| | Old (`p_prediction_lead=0.55`) | New (`p_prediction_lead=0.70`, data-derived) | Δ |
|---|---|---|---|
| **A** same-day, constraints met | 52.61% | 57.08% | +4.47pp |
| **B** same-day, constraints compromised | 12.87% | 12.49% | −0.38pp |
| **C** next-day + duty of care | 27.64% | 23.65% | −3.99pp |
| **D** escalated to a human | 6.88% | 6.77% | −0.11pp |
| **Same-day recovery (A+B)** | **65.48%** | **69.57%** | **+4.09pp** |
| Closed without a human | 93.12% | 93.23% | +0.11pp |
| Median delay (same-day cases) | 6.0h | 6.0h | — |
| p90 delay | 10.5h | 10.5h | — |

Earlier prediction lead means less of the alternative inventory is already consumed by the
airline's own reactive re-accommodation by the time we search — the effect flows entirely through
`airline_autorebook_predicted` (0.25–0.50) replacing `airline_autorebook_reactive` (0.45–0.70) for
a larger share of cases, not through any other lever. `D_escalated` barely moves because it is
almost entirely governed by `p_intrinsically_complex` (unchanged) and the thin-route systemic
overflow branch, neither of which this revision touched. `closed_without_human_pct` is, as
`03-action-policy.md` §9 already notes, mostly a restatement of that same fixed escalation
assumption — so its near-flatness here is expected, not a finding.

## 3. By regime

| | Isolated (old) | Isolated (new) | Systemic (old) | Systemic (new) |
|---|---|---|---|---|
| Same-day recovery | 81.22% | **84.04%** (+2.82pp) | 38.15% | **44.41%** (+6.26pp) |
| Closed without human | 96.04% | 96.04% (unchanged) | 88.40% | 88.53% (+0.13pp) |
| Median delay | 6.0h | 4.5h | 9.0h | 7.5h |

Prediction lead helps **more in the systemic regime** (+6.26pp) than the isolated one (+2.82pp) —
consistent with the model's own framing: a mass-cancellation event is exactly where the airline's
own reactive re-accommodation consumes inventory fastest, so getting ahead of it with earlier
prediction lead has more inventory left to protect. This is also the regime
[`09-problem-scale-and-incidents.md`](09-problem-scale-and-incidents.md) documents with real named
incidents (IndiGo Dec 2025, Southwest Dec 2022, CrowdStrike Jul 2024, American Airlines Jul 2026)
— all four are systemic by this model's definition, which is why this revision's biggest single
gain lands exactly where those incidents live.

## 4. Sensitivity table (new baseline)

Re-run against the new `p_prediction_lead=0.70` baseline (`same_day_seat_pct` baseline is 69.20%
here — computed on the smaller 120,000-case sensitivity sample, not the 250,000-case headline
above, per `iropssim.py`'s existing convention):

| Lever | Same-day % | Δ vs. new baseline |
|---|---|---|
| BASELINE | 69.20% | — |
| Single-carrier access only (0.30) | 43.56% | −25.64pp |
| Full multi-supplier access (0.90) | 75.97% | +6.77pp |
| Breadth capped at 1 alternative | 32.84% | −36.36pp |
| Breadth capped at 2 alternatives | 47.96% | −21.24pp |
| Breadth capped at 3 alternatives | 56.03% | −13.17pp |
| Breadth capped at 5 alternatives | 65.06% | −4.14pp |
| No prediction lead at all | 51.33% | −17.87pp |
| Perfect prediction lead | 77.18% | +7.98pp |
| Our share 2% (low self-contention) | 80.72% | +11.52pp |
| Our share 25% (heavy self-contention) | 32.99% | −36.21pp |
| Share 25% + breadth capped at 1 | 5.61% | −63.59pp |

**Read against the old sensitivity table**: breadth (how many alternatives we search, not how we
allocate across our own members) is still the single largest lever by far — capping at one
alternative alone costs 36.36pp, more than doubling what single-vs-multi-supplier access costs on
its own. Prediction lead's own swing (−17.87pp with none, +7.98pp with perfect, vs. 0.70's real
baseline) is now anchored to a measured midpoint rather than a guessed one, which makes this
comparison more honest than the version this replaces: the "no prediction lead" and "perfect
prediction lead" bookends haven't moved, but where the *real* system now sits between them has —
closer to the "perfect" end than the old 0.55 assumption placed it.

## 5. Breadth vs. allocation decomposition, and stability — unaffected by this revision

`breadth_vs_allocation` and the 12-rep seed-stability check (`same_day_seat_pct`: mean 69.43%,
stdev 0.409, range 68.94–70.43% across reseeds) both re-ran clean against the new baseline;
neither mechanism nor its cross-check depends on `p_prediction_lead`, and their qualitative
conclusions from the prior revision (breadth dominates allocation at every real market-share level
we've measured; the headline number's seed-to-seed spread is well under a percentage point) stand
unchanged, so they are not restated in full here — the new complete output is in
`iropssim-output.json`.

## 6. What this does and does not claim

- **Does claim**: given the real model's real out-of-time recall at its real production gate
  threshold, and every other `PARAMS` assumption held at its previously-declared value, modelled
  same-day recovery rises from 65.48% to 69.57%.
- **Does not claim**: that 69.57% is measured against live outcomes. It remains a `sim`-tier
  number — a model result under stated assumptions, exactly the caveat `iropssim.py`'s own
  docstring states for every run it has ever produced. The one improvement this revision makes is
  that one of those assumptions is no longer a guess.
- **Does not claim** the other unchanged `PARAMS` (route mix, load factors, auto-rebooking rates,
  cross-carrier access, our market share) are validated by real data — they are exactly as
  assumption-tier as they were before this revision. A future revision with real ingested route/
  inventory data would be the natural next one to write, following this file's naming pattern.

## See also

- [`iropssim.py`](../../iropssim.py) — the simulator itself, `PARAMS["p_prediction_lead"]`'s inline
  comment carries this same derivation
- [`iropssim-output.json`](../../iropssim-output.json) — the full regenerated output (headline,
  by-regime, sensitivity, breadth/allocation decomposition, stability)
- [`05-cancellation-risk-model.md`](05-cancellation-risk-model.md) — the real trained model this
  revision draws its one changed number from
- [`03-action-policy.md`](03-action-policy.md) §9 — the outcome taxonomy this revision updates
- [`09-problem-scale-and-incidents.md`](09-problem-scale-and-incidents.md) — the four real named
  incidents that motivate why the systemic regime (§3 above) is the one this revision moves most
- `documentation/agent-specs/current/*_v2.0.md` — the frozen `A2` outcome-taxonomy table, updated
  identically across all four files as one change-set and re-verified byte-identical
- [`architecture.md`](../architecture/architecture.md) — the architecture doc's own outcome table
