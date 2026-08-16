"""AWS Lambda entry points — infra/scoring.tf points batch_scorer and
event_scorer at `handler.batch_score` / `handler.event_score` in this
module's container image.

Feature ASSEMBLY (calling OAG, NOAA/Open-Meteo, the domain store) stays in
zkd-app/server/{oag,weather,riskModel}.ts — that is where the flight/booking
domain context already lives (server/domain/store.ts), and duplicating it in
Python here would be a second copy to keep in sync. These handlers score a
batch of ALREADY-ASSEMBLED feature vectors (the event payload), the same
contract riskModel.ts's local dev path uses against serve.py — so the exact
same code runs whether the caller is EventBridge+the Node app in AWS, or
`npm run dev` on a laptop.
"""
from __future__ import annotations

import json
import os
import time

import boto3

from inference import CancellationScorer

scorer = CancellationScorer()
dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")


def _forecast_table():
    return dynamodb.Table(os.environ["FORECAST_TABLE"])


def _write_decision_ledger(records: list[dict]) -> None:
    bucket = os.environ.get("DECISION_LEDGER_BUCKET")
    if not bucket or not records:
        return
    key = f"decision-ledger/risk-scores/{time.strftime('%Y/%m/%d')}/{int(time.time()*1000)}.jsonl"
    body = "\n".join(json.dumps(r) for r in records).encode()
    s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/x-ndjson")


def _score_batch(items: list[dict]) -> list[dict]:
    """Each item: {"flightId": str, "features": {...}}. Returns the scored
    rows, already written to DynamoDB with a TTL matching
    config/risk-thresholds.json's forecast.ttlMs."""
    table = _forecast_table()
    ttl_ms = int(os.environ.get("FORECAST_TTL_MS", 10 * 60 * 1000))
    results = []
    for item in items:
        try:
            # batch path — see serve.py's do_POST for why explain is off
            result = scorer.score(item["features"], explain=False)
        except Exception as e:
            # One bad item must not fail the whole scheduled sweep (the
            # same failure mode fixed in serve.py's do_POST) — record the
            # error against this flightId and keep scoring the rest.
            results.append({"flightId": item["flightId"], "error": str(e)})
            continue
        result["flightId"] = item["flightId"]
        result["asOf"] = int(time.time() * 1000)
        table.put_item(Item={
            "flightId": item["flightId"],
            "cancelProbability": str(result["cancelProbability"]),
            "confidence": str(result["confidence"]),
            "modelVersion": result["modelVersion"],
            "source": result["source"],
            "asOf": result["asOf"],
            "expiresAt": int(time.time()) + ttl_ms // 1000,
        })
        results.append(result)
    _write_decision_ledger(results)
    return results


def batch_score(event, _context):
    """Scheduled — see infra/scoring.tf aws_scheduler_schedule.batch_scorer.
    Expects {"flights": [{"flightId": ..., "features": {...}}, ...]} as the
    event payload; the caller (zkd-app's batch-refresh job) is what walks
    the active-window book and assembles each flight's features."""
    items = event.get("flights", [])
    scored = _score_batch(items)
    return {"scored": len(scored), "results": scored}


def event_score(event, _context):
    """Fired by infra/scoring.tf's material-signal EventBridge rule
    (schedule-change / cancellation-signal / upstream-rotation-delay).
    `event["detail"]` carries one flight's flightId + features, assembled by
    whatever raised the signal."""
    detail = event.get("detail", {})
    scored = _score_batch([{"flightId": detail["flightId"], "features": detail["features"]}])
    return scored[0]
