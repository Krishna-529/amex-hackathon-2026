"""Regression test for the origin_hour_density train/serve-skew bug a
VP-readiness audit caught (see documentation/design/05-cancellation-risk-model.md):
grouping by everything-before-the-trailing-":"-segment must recover one
real entry per origin airport, not collapse every airport under a
country's namespace prefix into one bucket. Uses a tiny synthetic
DataFrame — not the full 7.9M-row real dataset — so this runs in
milliseconds; the real training pipeline is exercised end-to-end by
actually running `python src/train.py`, not duplicated here.
"""
import pandas as pd

from train import compute_origin_hour_density


def test_recovers_one_entry_per_real_airport_not_per_country():
    # Two real airports under the same "BTS:" namespace, at two real hours
    # each, several days — the exact shape features.py's origin_hour_density
    # groups on (origin + calendar-date + hour).
    rows = []
    for day in range(1, 6):  # 5 days
        for _ in range(3):  # 3 departures that hour on JFK
            rows.append({"origin": "BTS:JFK", "sched_dep": pd.Timestamp(f"2024-01-{day:02d} 14:00:00")})
        for _ in range(1):  # 1 departure that hour on a quiet regional airport
            rows.append({"origin": "BTS:ABQ", "sched_dep": pd.Timestamp(f"2024-01-{day:02d} 09:00:00")})
    df = pd.DataFrame(rows)

    density_avg_by_origin_hour, global_avg = compute_origin_hour_density(df)

    # The real bug collapsed everything to {"BTS": <sum>} — exactly 2 keys
    # total across the whole dataset. The fix must produce one key per real
    # airport instead.
    assert set(density_avg_by_origin_hour.keys()) == {"BTS:JFK", "BTS:ABQ"}
    assert density_avg_by_origin_hour["BTS:JFK"] == 3.0  # 3 real departures/hour-slot, every day
    assert density_avg_by_origin_hour["BTS:ABQ"] == 1.0
    # Global fallback is the real median across 10 per-slot counts (five
    # slots of 3 from JFK, five slots of 1 from ABQ) — the true middle of
    # [1,1,1,1,1,3,3,3,3,3] is (1+3)/2 = 2.0, never a whole-year sum like 15.
    assert global_avg == 2.0


def test_handles_empty_frame_without_crashing():
    df = pd.DataFrame({"origin": pd.Series(dtype=str), "sched_dep": pd.Series(dtype="datetime64[ns]")})
    density_avg_by_origin_hour, global_avg = compute_origin_hour_density(df)
    assert density_avg_by_origin_hour == {}
    assert global_avg == 1.0
