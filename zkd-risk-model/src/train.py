"""Trains the real cancellation-probability model on the real BTS+ANAC
training table, calibrates it, and evaluates it honestly on a strictly
out-of-time holdout — no k-fold shuffling, because shuffling a time series
before splitting leaks the future into the past.

Model: gradient-boosted trees (XGBoost), CPU, matching
documentation/design/04-infrastructure-and-cost.md's own framing of where AI
belongs in this system — batch/event-scored, no GPU, no standing endpoint.

Three-way CHRONOLOGICAL split:
  train (first ~70% by sched_dep) -> fit the trees
  calib (next ~15%)               -> fit the probability calibrator only
  test  (last ~15%)               -> touched exactly once, for the numbers
                                      in reports/model_metrics.json
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.calibration import calibration_curve
from sklearn.impute import SimpleImputer
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, log_loss, roc_auc_score

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed"
MODELS = ROOT / "models"
REPORTS = ROOT / "reports"

FEATURE_COLS = [
    "carrier_hist_cancel_rate", "route_hist_cancel_rate", "origin_hist_cancel_rate",
    "dest_hist_cancel_rate", "origin_month_hist_cancel_rate",
    "month", "day_of_week", "hour_of_day", "is_redeye", "is_weekend",
    "distance_km", "sched_duration_min", "origin_hour_density",
    "prior_leg_cancelled", "international",
]
LABEL_COL = "cancelled"


def chronological_split(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    df = df.sort_values("sched_dep").reset_index(drop=True)
    n = len(df)
    train_end = int(n * 0.70)
    calib_end = int(n * 0.85)
    return df.iloc[:train_end], df.iloc[train_end:calib_end], df.iloc[calib_end:]


def compute_origin_hour_density(df_full: pd.DataFrame) -> tuple[dict, float]:
    """The live-serving reference table for origin_hour_density, built to
    match what features.py's origin_hour_density feature actually measures:
    a per-row count within ONE real hour-slot (origin + calendar date +
    hour, via .dt.floor("h")), typically single- or double-digit — NOT a
    whole-year sum per (origin, hour-of-day), which is a different quantity
    two orders of magnitude larger that would silently mismatch every live
    prediction against what the model was trained on (a real train/serve
    skew a VP-readiness audit caught — see
    documentation/design/05-cancellation-risk-model.md). Averages the real
    per-slot count per (origin, hour-of-day) across the days observed, then
    again across hours to the one number per origin the live lookup uses
    (riskModel.ts keys origin_hour_density_avg by origin only).

    Returns (density_avg_by_origin_hour, global_median_fallback) — the
    fallback is a MEDIAN, not a mean, of the real per-slot counts: a
    handful of major hubs' means would otherwise drag an unweighted average
    far above what a typical airport/hour looks like.
    """
    slot = df_full["sched_dep"].dt.floor("h")
    per_slot_count = (
        df_full.assign(_slot=slot).groupby(["origin", "_slot"]).size().rename("count").reset_index()
    )
    per_slot_count["hour"] = per_slot_count["_slot"].dt.hour
    density_by_origin_hour = per_slot_count.groupby(["origin", "hour"])["count"].mean()
    density_avg_by_origin_hour = (
        density_by_origin_hour.groupby(level=0).mean().to_dict() if len(density_by_origin_hour) else {}
    )
    global_avg = float(per_slot_count["count"].median()) if len(per_slot_count) else 1.0
    return density_avg_by_origin_hour, global_avg


def train() -> dict:
    df = pd.read_parquet(PROCESSED / "training_table.parquet")

    # Production never has this value: server/engine/riskModel.ts hardcodes
    # prior_leg_cancelled to null for every live flight (OAG Flight Info
    # Connections — the real source — is not available on this account, see
    # .env.example). Left as-is, this column was present on ~88% of real
    # training/test rows (BTS US flights with a tail number) and became the
    # single highest-gain feature by roughly 15x over everything else
    # combined — the model learned to lean on a signal it will NEVER receive
    # live. Forced-null evaluation on the previous artifact confirmed the
    # real cost: ROC-AUC 0.873 (as normally evaluated) -> 0.805 (forced null,
    # i.e. what a live prediction actually gets) — see
    # documentation/design/05-cancellation-risk-model.md for the full
    # before/after. Masking it to NaN for every row, before the chronological
    # split even happens, forces the trees to build real splits on the other
    # 14 features instead of a feature that is fiction at serving time.
    df["prior_leg_cancelled"] = np.nan

    train_df, calib_df, test_df = chronological_split(df)
    print(f"train={len(train_df):,} calib={len(calib_df):,} test={len(test_df):,} "
          f"(split boundaries: {train_df['sched_dep'].max()} | {calib_df['sched_dep'].max()})")

    X_train, y_train = train_df[FEATURE_COLS], train_df[LABEL_COL]
    X_calib, y_calib = calib_df[FEATURE_COLS], calib_df[LABEL_COL]
    X_test, y_test = test_df[FEATURE_COLS], test_df[LABEL_COL]

    pos_rate = y_train.mean()
    scale_pos_weight = (1 - pos_rate) / pos_rate  # real class imbalance (~1-6% positive), not invented

    dtrain = xgb.DMatrix(X_train, label=y_train, missing=np.nan)
    dcalib = xgb.DMatrix(X_calib, label=y_calib, missing=np.nan)
    dtest = xgb.DMatrix(X_test, label=y_test, missing=np.nan)

    params = {
        "objective": "binary:logistic",
        "eval_metric": "aucpr",  # PR-AUC — the honest metric at ~2% positive rate; ROC-AUC alone flatters imbalanced problems
        "max_depth": 6,
        "eta": 0.08,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "scale_pos_weight": scale_pos_weight,
        "tree_method": "hist",
        "seed": 42,
    }

    booster = xgb.train(
        params, dtrain, num_boost_round=500,
        evals=[(dtrain, "train"), (dcalib, "calib")],
        early_stopping_rounds=30, verbose_eval=50,
    )
    # Trim to the best round so a plain .predict() at serving time (no
    # iteration_range bookkeeping to get right) uses exactly the
    # early-stopped model, not the extra rounds grown past it.
    booster = booster[: booster.best_iteration + 1]

    # --- Calibration -------------------------------------------------------
    # The raw booster output is a RANKING signal, not a calibrated
    # probability — scale_pos_weight and boosting both distort the absolute
    # scale. lib/thresholds.ts acts on the absolute percentage (25/55/80),
    # so an uncalibrated score would fire bands at the wrong real-world
    # frequency. Isotonic regression fit on the untouched calib split fixes
    # this without assuming a parametric shape.
    raw_calib_pred = booster.predict(dcalib)
    calibrator = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1)
    calibrator.fit(raw_calib_pred, y_calib)

    # --- Honest evaluation on test, touched once ----------------------------
    raw_test_pred = booster.predict(dtest)
    calibrated_test_pred = calibrator.predict(raw_test_pred)

    frac_pos, mean_pred = calibration_curve(y_test, calibrated_test_pred, n_bins=10, strategy="quantile")

    # --- Naive baselines, so "PR-AUC 0.236" has something real to be
    # compared against instead of standing alone. "Always predict the
    # training base rate" is the floor a model must clear to be worth
    # anything; logistic regression on the same real features is a real,
    # not hypothetical, second-simplest model. ------------------------------
    base_rate_pred = np.full(len(y_test), pos_rate)
    baseline_base_rate = {
        "roc_auc": float(roc_auc_score(y_test, base_rate_pred)),
        "pr_auc": float(average_precision_score(y_test, base_rate_pred)),
        "brier_score": float(brier_score_loss(y_test, base_rate_pred)),
    }

    imputer = SimpleImputer(strategy="median")
    X_train_imp = imputer.fit_transform(X_train)
    X_test_imp = imputer.transform(X_test)
    logreg = LogisticRegression(max_iter=1000, class_weight="balanced")
    logreg.fit(X_train_imp, y_train)
    logreg_pred = logreg.predict_proba(X_test_imp)[:, 1]
    baseline_logistic_regression = {
        "roc_auc": float(roc_auc_score(y_test, logreg_pred)),
        "pr_auc": float(average_precision_score(y_test, logreg_pred)),
        "brier_score": float(brier_score_loss(y_test, logreg_pred)),
        "note": "raw predict_proba, not isotonic-calibrated like the XGBoost numbers above — "
                "ROC-AUC/PR-AUC are ranking metrics unaffected by calibration, Brier is not "
                "directly comparable to the calibrated XGBoost Brier score",
    }

    # --- Lift table: real concentration of true positives in the model's
    # own top deciles vs the real test-set base rate — this is where
    # "22x better than guessing" comes from, computed, not asserted. -------
    test_base_rate = float(y_test.mean())
    lift_table = [
        {
            "decile_mean_predicted": float(mp),
            "decile_fraction_positive": float(fp),
            "lift_over_base_rate": float(fp / test_base_rate) if test_base_rate > 0 else None,
        }
        for mp, fp in zip(mean_pred, frac_pos)
    ]

    # --- Segment breakdown: does the model hold up per-country and
    # per-month, or does the headline number hide a regime where it's
    # actually weak? ---------------------------------------------------------
    country_vals = test_df["country"].to_numpy()
    month_vals = test_df["month"].to_numpy()
    y_test_arr = y_test.to_numpy()
    segment_metrics: dict = {"by_country": {}, "by_month": {}}
    for country in sorted(set(country_vals)):
        mask = country_vals == country
        yt, pt = y_test_arr[mask], calibrated_test_pred[mask]
        if len(set(yt)) < 2:
            continue
        segment_metrics["by_country"][str(country)] = {
            "n": int(mask.sum()), "positive_rate": float(yt.mean()),
            "roc_auc": float(roc_auc_score(yt, pt)), "pr_auc": float(average_precision_score(yt, pt)),
        }
    for month in sorted(set(month_vals)):
        mask = month_vals == month
        yt, pt = y_test_arr[mask], calibrated_test_pred[mask]
        if len(set(yt)) < 2:
            continue
        segment_metrics["by_month"][str(int(month))] = {
            "n": int(mask.sum()), "positive_rate": float(yt.mean()),
            "roc_auc": float(roc_auc_score(yt, pt)), "pr_auc": float(average_precision_score(yt, pt)),
        }

    metrics = {
        "trained_at": pd.Timestamp.now("UTC").isoformat(),
        "n_train": len(train_df), "n_calib": len(calib_df), "n_test": len(test_df),
        "positive_rate_train": float(pos_rate),
        "positive_rate_test": float(y_test.mean()),
        "best_iteration": int(getattr(booster, "best_iteration", booster.num_boosted_rounds() - 1)),
        "roc_auc": float(roc_auc_score(y_test, calibrated_test_pred)),
        "pr_auc": float(average_precision_score(y_test, calibrated_test_pred)),
        "brier_score": float(brier_score_loss(y_test, calibrated_test_pred)),
        "log_loss": float(log_loss(y_test, calibrated_test_pred, labels=[0, 1])),
        "calibration_curve": {"mean_predicted": mean_pred.tolist(), "fraction_positive": frac_pos.tolist()},
        "feature_importance": {
            k: float(v) for k, v in
            sorted(booster.get_score(importance_type="gain").items(), key=lambda kv: -kv[1])
        },
        "data_sources": {"BTS_US": int((df["country"] == "US").sum()), "ANAC_BR": int((df["country"] == "BR").sum())},
        "baseline_base_rate": baseline_base_rate,
        "baseline_logistic_regression": baseline_logistic_regression,
        "lift_table": lift_table,
        "segment_metrics": segment_metrics,
    }
    return {"booster": booster, "calibrator": calibrator, "metrics": metrics}


if __name__ == "__main__":
    MODELS.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)

    result = train()
    booster, calibrator, metrics = result["booster"], result["calibrator"], result["metrics"]

    booster.save_model(str(MODELS / "cancellation_model.json"))

    # --- Live-serving reference table --------------------------------------
    # The historical-rate features (carrier_hist_cancel_rate, etc.) are
    # expanding-window stats computed here at training time. A live request
    # in zkd-app/server/riskModel.ts cannot recompute an expanding window
    # over millions of rows per call — it looks up the LATEST smoothed rate
    # per entity instead, refreshed every retrain (weekly, see
    # zkd-risk-model/infra/training.tf). This is the real thing a feature
    # store gives you; exporting it as one JSON is the honest minimum
    # version of that for this project's scale.
    df_full = pd.read_parquet(PROCESSED / "training_table.parquet").sort_values("sched_dep")
    global_prior = float(df_full[LABEL_COL].mean())

    def latest_rates(col: str) -> dict:
        g = df_full.groupby(col, observed=True)[LABEL_COL]
        n = g.transform("count")
        s = g.transform("sum")
        smoothed = (s + global_prior * 20.0) / (n + 20.0)
        df_full["_smoothed_tmp"] = smoothed
        return df_full.drop_duplicates(col, keep="last").set_index(col)["_smoothed_tmp"].to_dict()

    df_full["route"] = df_full["origin"].astype(str) + ">" + df_full["dest"].astype(str)
    df_full["origin_month"] = df_full["origin"].astype(str) + ":" + df_full["month"].astype(str)
    density_avg_by_origin_hour, origin_hour_density_global_avg = compute_origin_hour_density(df_full)

    entity_rates = {
        "global_prior": global_prior,
        "as_of": df_full["sched_dep"].max().isoformat(),
        "carrier": latest_rates("carrier"),
        "origin": latest_rates("origin"),
        "dest": latest_rates("dest"),
        "route": latest_rates("route"),
        "origin_month": latest_rates("origin_month"),
        "origin_hour_density_avg": {k: float(v) for k, v in density_avg_by_origin_hour.items()},
        # Real median of the per-slot counts above — the fallback a
        # LIVE:-namespaced (cold-start) airport gets, same honest pattern as
        # global_prior for the historical-rate tables.
        "origin_hour_density_global_avg": origin_hour_density_global_avg,
    }
    (MODELS / "entity_rates.json").write_text(json.dumps(entity_rates, indent=2, default=str))
    print(f"saved entity reference rates -> {MODELS / 'entity_rates.json'}")
    np.savez(
        MODELS / "calibrator_isotonic.npz",
        X_=calibrator.X_thresholds_, y_=calibrator.y_thresholds_,
    )
    (MODELS / "feature_columns.json").write_text(json.dumps(FEATURE_COLS, indent=2))
    (REPORTS / "model_metrics.json").write_text(json.dumps(metrics, indent=2))

    # --- Real reliability diagram, not just the calibration_curve numbers --
    mp, fp = metrics["calibration_curve"]["mean_predicted"], metrics["calibration_curve"]["fraction_positive"]
    fig, ax = plt.subplots(figsize=(5, 5))
    lim = max(mp + fp) * 1.05 if (mp and fp) else 1.0
    ax.plot([0, lim], [0, lim], "--", color="gray", linewidth=1, label="perfect calibration")
    ax.plot(mp, fp, "o-", color="#2f7ff0", label="this model (real out-of-time test set)")
    ax.set_xlabel("mean predicted probability (decile)")
    ax.set_ylabel("observed cancellation rate (decile)")
    ax.set_title("Calibration reliability diagram")
    ax.legend()
    fig.tight_layout()
    fig.savefig(REPORTS / "calibration_plot.png", dpi=150)
    plt.close(fig)
    print(f"saved calibration plot -> {REPORTS / 'calibration_plot.png'}")

    _skip = ("calibration_curve", "feature_importance", "lift_table", "segment_metrics")
    print(json.dumps({k: v for k, v in metrics.items() if k not in _skip}, indent=2))
    print(f"\ntop-decile lift over base rate: {metrics['lift_table'][-1]['lift_over_base_rate']:.1f}x")
    print(f"baseline (base rate only)      pr_auc={metrics['baseline_base_rate']['pr_auc']:.4f}")
    print(f"baseline (logistic regression) pr_auc={metrics['baseline_logistic_regression']['pr_auc']:.4f}")
    print(f"this model (xgboost)           pr_auc={metrics['pr_auc']:.4f}")
    print(f"\nsaved model -> {MODELS / 'cancellation_model.json'}")
    print(f"saved metrics -> {REPORTS / 'model_metrics.json'}")
