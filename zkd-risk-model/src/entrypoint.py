"""Unattended retrain entrypoint — infra/training.tf's weekly Fargate Spot
task runs this (Dockerfile.trainer's CMD) with no interactive input and no
human watching. Chains the same real steps README.md's quickstart documents
by hand: download real BTS+ANAC data -> ingest -> features -> train -> ship
the retrained artifact where the scoring Lambdas (scoring.tf) can find it.

Real data is cached in S3 (DATA_LAKE_BUCKET) across runs so a weekly retrain
doesn't re-download ~600MB of public zips every time; the trained model and
its metrics are uploaded to MODEL_BUCKET so scoring.tf's Lambdas — which
already read from that bucket — pick up the fresh artifact on their next
cold start.

Local dev is unaffected: with DATA_LAKE_BUCKET/MODEL_BUCKET unset, this is
just download_data.sh -> download_anac.sh -> ingest_*.py -> features.py ->
train.py against the local filesystem, same as running each by hand.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_RAW = ROOT / "data" / "raw"
MODELS = ROOT / "models"
REPORTS = ROOT / "reports"

DATA_LAKE_BUCKET = os.environ.get("DATA_LAKE_BUCKET")
MODEL_BUCKET = os.environ.get("MODEL_BUCKET")


def run(cmd: list[str]) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, check=True, cwd=ROOT)


def _upload_dir(local_dir: Path, bucket: str, prefix: str) -> int:
    import boto3
    s3 = boto3.client("s3")
    n = 0
    for path in local_dir.rglob("*"):
        if path.is_file():
            key = f"{prefix}/{path.relative_to(local_dir).as_posix()}"
            s3.upload_file(str(path), bucket, key)
            n += 1
    return n


def restore_raw_data_from_s3() -> bool:
    """True if a real cached copy was restored — lets the caller skip the download."""
    if not DATA_LAKE_BUCKET:
        return False
    import boto3
    s3 = boto3.client("s3")
    paginator = s3.get_paginator("list_objects_v2")
    found = False
    for page in paginator.paginate(Bucket=DATA_LAKE_BUCKET, Prefix="raw/"):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            dest = DATA_RAW / key[len("raw/"):]
            dest.parent.mkdir(parents=True, exist_ok=True)
            s3.download_file(DATA_LAKE_BUCKET, key, str(dest))
            found = True
    return found


def cache_raw_data_to_s3() -> None:
    if not DATA_LAKE_BUCKET:
        return
    n = _upload_dir(DATA_RAW, DATA_LAKE_BUCKET, "raw")
    print(f"cached {n} raw data files -> s3://{DATA_LAKE_BUCKET}/raw/", flush=True)


def upload_artifacts_to_s3() -> None:
    if not MODEL_BUCKET:
        print("MODEL_BUCKET not set — leaving model artifacts local only", flush=True)
        return
    n_models = _upload_dir(MODELS, MODEL_BUCKET, "models")
    n_reports = _upload_dir(REPORTS, MODEL_BUCKET, "reports")
    print(f"uploaded {n_models} model files + {n_reports} report files -> s3://{MODEL_BUCKET}/", flush=True)


def main() -> None:
    restored = restore_raw_data_from_s3()
    if restored:
        print("restored real BTS+ANAC data from S3 cache — skipping the ~600MB re-download", flush=True)
    else:
        print("no S3 cache hit (or DATA_LAKE_BUCKET unset) — downloading real BTS+ANAC data", flush=True)
        run(["bash", "src/download_data.sh"])
        run(["bash", "src/download_anac.sh"])
        run(["bash", "src/download_uk_caa.sh"])
        run(["bash", "src/download_dgca.sh"])
        cache_raw_data_to_s3()

    run([sys.executable, "src/ingest_bts.py"])
    run([sys.executable, "src/ingest_anac.py"])
    run([sys.executable, "src/ingest_uk_caa.py"])
    run([sys.executable, "src/ingest_india_synthetic.py"])
    run([sys.executable, "src/ingest_india_dgca.py"])
    run([sys.executable, "src/features.py"])
    run([sys.executable, "src/train.py"])
    # Regenerates score_percentile_lookup.npy (riskScore's basis) alongside
    # reports/score_distribution.json — a retrain can shift the model's
    # calibrated output range, and a stale lookup would silently make
    # riskScore's percentile ranks wrong without ever erroring.
    run([sys.executable, "src/score_distribution.py"])

    upload_artifacts_to_s3()
    print("retrain complete", flush=True)


if __name__ == "__main__":
    main()
