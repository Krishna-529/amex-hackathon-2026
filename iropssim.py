"""
ZKD Concierge — IROPS re-accommodation Monte Carlo.

Question: of our disrupted card members, what fraction do we successfully
re-book, and under what conditions does that number collapse?

Model is event-level, not passenger-level, because contention is the whole
point: displaced passengers on one cancelled flight compete for the SAME
finite pool of alternative seats. Independent per-passenger draws would
model away the exact thing we are trying to measure.

Every parameter is declared in PARAMS with its rationale. Outputs are model
results under stated assumptions, NOT measurements.
"""

import json
import random
import statistics
from collections import Counter

SEED = 20260726
N_CASES = 250_000          # 2.5 lakh of OUR customer disruption cases

PARAMS = {
    # --- aircraft / load -------------------------------------------------
    # Indian domestic narrowbody fleet is A320/737 dominated.
    "seats_per_aircraft": 180,
    # Indian domestic load factors run high; systemic events push them higher
    # as displaced passengers fill remaining inventory.
    "load_factor_normal": 0.87,
    "load_factor_systemic": 0.92,

    # --- event regime ----------------------------------------------------
    # Isolated  = one flight cancels on an otherwise normal day.
    # Systemic  = mass cancellation (the Dec 2025 IndiGo-style event the deck
    #             sizes for). Alternatives are themselves saturated because
    #             everyone is displaced at once.
    "p_systemic": 0.35,

    # --- route thickness: alternatives reachable in the recovery window ---
    # trunk  (MAA-DEL, BOM-DEL): many daily frequencies, multiple carriers
    # medium: several frequencies
    # thin   : regional, 1-2 options a day
    "route_mix": {"trunk": 0.30, "medium": 0.45, "thin": 0.25},
    "alts": {"trunk": (8, 14), "medium": (4, 8), "thin": (1, 3)},
    # hours between consecutive usable alternatives
    "spacing_h": {"trunk": 1.5, "medium": 3.0, "thin": 7.0},

    # --- who takes the seats before we do --------------------------------
    # The carrier's own IROPS engine auto-reaccommodates its passengers first,
    # typically onto its own metal, often before the cancellation is public.
    "airline_autorebook_reactive": (0.45, 0.70),
    # With prediction lead we are in the market earlier, so less is gone.
    "airline_autorebook_predicted": (0.25, 0.50),
    # Other agencies / direct bookers taking remaining inventory.
    "other_demand": (0.10, 0.30),

    # --- our access ------------------------------------------------------
    # Fraction of route alternatives we can actually transact on. Single-GDS
    # single-carrier access is far lower than a multi-supplier abstraction.
    "cross_carrier_access": (0.60, 0.80),

    # --- our footprint ---------------------------------------------------
    # Share of displaced passengers on a given flight who are our members.
    # Deliberately realistic: a premium card cohort is a small slice, which
    # also means self-contention is low.
    "our_share": (0.02, 0.06),

    # --- prediction ------------------------------------------------------
    # DATA-DERIVED, not hand-picked, as of this revision. Earlier versions of
    # this file guessed 0.55 from the "weather is forecastable, ATC/crew
    # mostly isn't" argument alone. We now have a real trained model
    # (documentation/design/05-cancellation-risk-model.md: XGBoost on
    # 7.9M real BTS+ANAC rows, ROC-AUC 0.804, PR-AUC 0.123) and its real
    # decile lift table (zkd-risk-model/reports/model_metrics.json).
    #
    # The production alt-search pre-cache gate fires at riskScore >= 75,
    # i.e. the top 25% of flights by calibrated risk percentile (05 §6).
    # Reconstructing recall at that exact cutoff from the real lift table:
    #   top 20% of flights by risk capture 66.0% of real cancellations
    #   top 30% of flights by risk capture 74.7% of real cancellations
    # linearly interpolated to the top-25% production cutoff -> ~70.3%.
    # That is "prediction lead" in this model's own terms: the fraction of
    # disruption cases where the real scorer would have crossed the gate
    # and triggered alt-search before the cancellation confirmed. Rounded
    # to 0.70. This number moves if the model is retrained or the gate
    # threshold changes - re-derive from model_metrics.json's lift_table,
    # don't hand-edit it back to a guess. Full derivation:
    # documentation/design/10-monte-carlo-revision-2026-08.md §1.
    "p_prediction_lead": 0.70,

    # --- passenger constraints -------------------------------------------
    # Fraction with a binding onward connection or hard time commitment.
    "p_hard_constraint": 0.30,
    # Slack hours available before the commitment breaks.
    "slack_hard": (2.0, 8.0),
    "slack_soft": (6.0, 24.0),

    # --- escalation ------------------------------------------------------
    # Irreducibly complex cases: multi-city, visa/immigration, unaccompanied
    # minors, medical, special assistance. Always go to a human.
    "p_intrinsically_complex": 0.04,

    # Beyond this, a "same day" recovery is not meaningfully same day - it
    # becomes an overnight case with hotel and duty of care.
    "same_day_cutoff_h": 12.0,
}


def tri(rng, lo, hi):
    """Triangular draw over a stated range - mode at midpoint."""
    return rng.triangular(lo, hi, (lo + hi) / 2.0)


def run(params, n_cases=N_CASES, seed=SEED, max_alts=None, share_override=None,
        access_override=None):
    """Run the model.

    max_alts caps how many alternatives we can SEE and transact on. None = all
    of them. This is the BREADTH lever and it is deliberately separate from the
    allocation loop below, which is the ALLOCATION lever. Collapsing the two
    into one boolean (the old `portfolio=False`) attributed breadth's effect to
    allocation - see decomposition_breadth_vs_allocation().
    """
    rng = random.Random(seed)
    outcomes = Counter()
    delays = []
    ours_total = 0
    events = 0

    route_names = list(params["route_mix"].keys())
    route_w = [params["route_mix"][r] for r in route_names]

    while ours_total < n_cases:
        events += 1
        systemic = rng.random() < params["p_systemic"]
        lf = params["load_factor_systemic"] if systemic else params["load_factor_normal"]

        route = rng.choices(route_names, weights=route_w, k=1)[0]
        lo, hi = params["alts"][route]
        n_alts = rng.randint(lo, hi)
        spacing = params["spacing_h"][route]

        displaced = int(params["seats_per_aircraft"] * lf)

        # Raw empty seats on ONE alternative in the window. Systemic scarcity is
        # applied per-alternative where the inventory is actually built, below -
        # not aggregated here.
        seats_per_alt = params["seats_per_aircraft"] * (1.0 - lf)

        predicted = rng.random() < params["p_prediction_lead"]
        ar_lo, ar_hi = (params["airline_autorebook_predicted"] if predicted
                        else params["airline_autorebook_reactive"])
        taken_airline = tri(rng, ar_lo, ar_hi)
        taken_other = tri(rng, *params["other_demand"])

        access = access_override if access_override is not None else tri(rng, *params["cross_carrier_access"])
        share = share_override if share_override is not None else tri(rng, *params["our_share"])
        ours = max(1, int(round(displaced * share)))

        # Build per-alternative inventory. Empty seats are SCATTERED across
        # frequencies, not packed front-to-back - but earlier alternatives are
        # consumed more heavily, because that is what everyone wants.
        base_take = min(0.97, taken_airline + taken_other)
        alt_pool = []
        for j in range(n_alts):
            seats_j = seats_per_alt
            if systemic:
                seats_j *= tri(rng, 0.25, 0.55)
            # earlier flights ~1.25x the take rate, later ~0.75x
            w = 1.25 - 0.5 * (j / max(1, n_alts - 1)) if n_alts > 1 else 1.0
            take_j = min(0.98, base_take * w)
            free_j = seats_j * (1.0 - take_j) * access
            alt_pool.append([(j + 1) * spacing, free_j])

        # BREADTH: how many alternatives we can see at all. Capping this to 1 is
        # "we only ever looked at the single best flight" - it costs recovery even
        # for a lone passenger with nobody to contend with, because that flight is
        # already full of OTHER carriers' displaced passengers.
        if max_alts is not None:
            alt_pool = alt_pool[:max_alts]

        # ALLOCATION: assign our users earliest-first across whatever we can reach,
        # advancing when an alternative is exhausted. This is what stops OUR OWN
        # members colliding on the same seat; its value scales with our share.
        assigned = []
        ai = 0
        for _ in range(ours):
            while ai < len(alt_pool) and alt_pool[ai][1] < 1.0:
                ai += 1
            if ai >= len(alt_pool):
                assigned.append(None)
            else:
                assigned.append(alt_pool[ai][0])
                alt_pool[ai][1] -= 1.0

        for k in range(ours):
            if ours_total >= n_cases:
                break
            ours_total += 1

            if rng.random() < params["p_intrinsically_complex"]:
                outcomes["D_escalated"] += 1
                continue

            hard = rng.random() < params["p_hard_constraint"]
            slack = (tri(rng, *params["slack_hard"]) if hard
                     else tri(rng, *params["slack_soft"]))

            delay = assigned[k]
            same_day_cutoff = params["same_day_cutoff_h"]

            if delay is not None and delay <= same_day_cutoff:
                delays.append(delay)
                if delay <= slack:
                    outcomes["A_same_day_constraints_met"] += 1
                else:
                    # Seat secured same day but the commitment breaks; we
                    # repair the onward leg and downstream bookings too.
                    outcomes["B_same_day_compromised"] += 1
            else:
                # Nothing reachable same day. Next-day flight + hotel + meals,
                # claimed from the carrier as duty of care.
                if route == "thin" and systemic and rng.random() < 0.35:
                    outcomes["D_escalated"] += 1
                else:
                    outcomes["C_next_day_duty_of_care"] += 1

    total = sum(outcomes.values())
    res = {k: outcomes.get(k, 0) for k in
           ["A_same_day_constraints_met", "B_same_day_compromised",
            "C_next_day_duty_of_care", "D_escalated"]}
    pct = {k: round(100.0 * v / total, 2) for k, v in res.items()}
    closed_no_human = 100.0 - pct["D_escalated"]
    same_day = pct["A_same_day_constraints_met"] + pct["B_same_day_compromised"]

    return {
        "n": total,
        "events": events,
        "counts": res,
        "pct": pct,
        "same_day_seat_pct": round(same_day, 2),
        "closed_without_human_pct": round(closed_no_human, 2),
        "median_delay_h": round(statistics.median(delays), 2) if delays else None,
        "p90_delay_h": round(sorted(delays)[int(0.9 * len(delays))], 2) if delays else None,
    }


def by_regime(params, seed=SEED):
    """Same model forced into each regime so the spread is visible."""
    out = {}
    for name, p_sys in (("isolated", 0.0), ("systemic", 1.0)):
        p = json.loads(json.dumps(params))
        p["p_systemic"] = p_sys
        out[name] = run(p, n_cases=120_000, seed=seed + 7)
    return out


def sensitivity(params, seed=SEED):
    """Which assumption actually moves the number?"""
    base = run(params, n_cases=120_000, seed=seed + 13)
    rows = []

    def add(label, res):
        rows.append({
            "lever": label,
            "closed_without_human_pct": res["closed_without_human_pct"],
            "same_day_seat_pct": res["same_day_seat_pct"],
            "delta_same_day": round(res["same_day_seat_pct"] - base["same_day_seat_pct"], 2),
        })

    add("BASELINE", base)

    # Cross-carrier access: single-carrier vs full multi-supplier
    add("Single-carrier access only (0.30)",
        run(params, 120_000, seed + 13, access_override=0.30))
    add("Full multi-supplier access (0.90)",
        run(params, 120_000, seed + 13, access_override=0.90))

    # BREADTH curve: how many alternatives we look at. Note the first step
    # (1 -> 2) buys most of it. This is NOT an allocation effect.
    for m in (1, 2, 3, 5):
        add(f"Breadth capped at {m} alternative{'s' if m > 1 else ''}",
            run(params, 120_000, seed + 13, max_alts=m))

    # Prediction lead
    p_nopred = json.loads(json.dumps(params)); p_nopred["p_prediction_lead"] = 0.0
    add("No prediction lead at all", run(p_nopred, 120_000, seed + 13))
    p_allpred = json.loads(json.dumps(params)); p_allpred["p_prediction_lead"] = 1.0
    add("Perfect prediction lead", run(p_allpred, 120_000, seed + 13))

    # Our market share - self-contention
    add("Our share 2% (low self-contention)",
        run(params, 120_000, seed + 13, share_override=0.02))
    add("Our share 25% (heavy self-contention)",
        run(params, 120_000, seed + 13, share_override=0.25))
    add("Share 25% + breadth capped at 1",
        run(params, 120_000, seed + 13, share_override=0.25, max_alts=1))

    # The escalation floor. closed_without_human tracks THIS assumption almost
    # 1:1 - it is the parameter the metric is really reporting, so it belongs in
    # the sensitivity table rather than being quoted as a model finding.
    for pc in (0.0, 0.02, 0.10, 0.20):
        p = json.loads(json.dumps(params)); p["p_intrinsically_complex"] = pc
        add(f"p_intrinsically_complex = {pc}", run(p, 120_000, seed + 13))

    return rows


def decomposition_breadth_vs_allocation(params, seed=SEED):
    """Split the old single 'portfolio' lever into its two real mechanisms.

    The old model conflated them: `portfolio=False` truncated the candidate list
    to ONE alternative, which simultaneously removed breadth AND removed any
    scope for allocation, then attributed the whole delta to allocation.

    Isolation trick: at share -> 0 exactly one of our members exists per event,
    so self-contention is impossible by construction and anything the cap still
    costs is pure breadth.
    """
    rows = []
    for label, sh in (("isolated member (share 0.001)", 0.001),
                      ("our real share 2%", 0.02),
                      ("our real share 6%", 0.06),
                      ("hypothetical share 25%", 0.25)):
        full = run(params, 120_000, seed + 13, share_override=sh)["same_day_seat_pct"]
        one = run(params, 120_000, seed + 13, share_override=sh,
                  max_alts=1)["same_day_seat_pct"]
        rows.append({
            "cohort": label,
            "share": sh,
            "same_day_full_breadth": full,
            "same_day_one_alternative": one,
            "combined_lever_pts": round(full - one, 2),
        })

    breadth_only = rows[0]["combined_lever_pts"]
    return {
        "rows": rows,
        "breadth_pts_no_contention_possible": breadth_only,
        "note": ("At share 0.001 there is exactly ONE of our members per event, so "
                 "no self-contention can exist. Whatever the 1-alternative cap "
                 "still costs there is BREADTH - searching more than one flight. "
                 "Allocation across our own members is the remainder, and only "
                 "that remainder scales with our share."),
    }


def ci(params, seed=SEED, reps=12):
    """Seed-to-seed spread, for BOTH reported metrics.

    same_day_seat_pct is the number we lead with, so it is the one that most
    needs a published interval; closed_without_human_pct is reported alongside.
    """
    runs = [run(params, 40_000, seed + 100 * i) for i in range(reps)]
    out = {"reps": reps}
    for metric in ("same_day_seat_pct", "closed_without_human_pct"):
        vals = [r[metric] for r in runs]
        out[metric] = {
            "mean": round(statistics.mean(vals), 2),
            "stdev": round(statistics.pstdev(vals), 3),
            "min": min(vals),
            "max": max(vals),
        }
    return out


if __name__ == "__main__":
    out = {
        "params": PARAMS,
        "headline": run(PARAMS),
        "by_regime": by_regime(PARAMS),
        "sensitivity": sensitivity(PARAMS),
        "breadth_vs_allocation": decomposition_breadth_vs_allocation(PARAMS),
        "stability": ci(PARAMS),
    }
    print(json.dumps(out, indent=2))
