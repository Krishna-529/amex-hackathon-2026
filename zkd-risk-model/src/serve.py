"""Local scoring endpoint for `npm run dev` — zkd-app/server/riskModel.ts
calls this over HTTP (RISK_MODEL_URL, default http://localhost:8090/score)
so the exact same trained artifact and inference code path runs in dev,
in the demo, and in the Lambda handler (handler.py) that AWS actually
schedules. stdlib-only (no FastAPI/uvicorn) to keep the venv this project
needs to a minimum: pandas, numpy, xgboost, scikit-learn.

Run: python src/serve.py [port]
"""
from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from inference import CancellationScorer

scorer = CancellationScorer()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter default access log
        print(f"[risk-scorer] {self.address_string()} {fmt % args}")

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok", "modelVersion": scorer.model_version})
            return
        if self.path == "/entity-rates":
            # zkd-app/server/riskModel.ts's feature-assembly step needs these
            # to compute carrier/route/origin historical-rate features
            # without re-deriving an expanding window itself. Served over
            # HTTP rather than read off disk so the same call works whether
            # this process is local:8090 or a deployed AWS endpoint.
            # `live_synthetic` rides alongside the real table under its own
            # key — never merged in — so the TS side can tell a
            # synthetic-market-estimate apart from this entity's real
            # trained history and label it accordingly.
            payload = dict(scorer.entity_rates)
            payload["live_synthetic"] = scorer.entity_rates_synthetic
            self._json(200, payload)
            return
        self._json(404, {"error": "not found"})

    MAX_BODY_BYTES = 5 * 1024 * 1024  # a few hundred flights of feature JSON, generously capped

    def do_POST(self):
        if self.path != "/score":
            self._json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", 0))
        if length > self.MAX_BODY_BYTES:
            self._json(413, {"error": f"body too large ({length} bytes, max {self.MAX_BODY_BYTES})"})
            return
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid JSON"})
            return

        if isinstance(body, list):
            # Batch path (the interval re-scorer) — one bad item must not
            # 500 the whole sweep. Per-item try/except, error kept in the
            # item's own slot so the caller's index alignment still holds.
            # Skip the extra tree-SHAP pass per flight; nobody is looking at
            # a batch explanation, and it's real cost at real flight-count
            # scale.
            result = []
            for f in body:
                try:
                    result.append(scorer.score(f, explain=False))
                except Exception as e:  # a real scoring failure — report it, never fabricate a probability instead
                    result.append({"error": str(e)})
            self._json(200, result)
            return

        try:
            # Single-flight path (a live audit view) — explanation on by
            # default, it's the real "reasons" server/engine/riskModel.ts
            # surfaces.
            result = scorer.score(body, explain=True)
            self._json(200, result)
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _json(self, status: int, payload) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
    print(f"risk scorer listening on :{port} (model {scorer.model_version}, "
          f"global prior {scorer.entity_rates['global_prior']:.4%})")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
