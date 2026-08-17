# Infrastructure & cost — why there is no GPU on the critical path

**ZKD Concierge · Codestreet 2026 / American Express**

The question a technical judge will ask is *"how is this fast, and what does it cost to run?"*
The answer is uncomfortable for the AI framing and excellent for the business case: **the live
path is network-bound, not compute-bound.**

---

## 1. Where the 11 seconds actually goes

| | Time | Share | Runs on |
|---|---|---|---|
| Thinking — allocation, 3 negotiation rounds, policy gate | **0.61 s** | **5%** | CPU |
| Waiting on airlines, hotels, payments | **10.8 s** | **95%** | Someone else's servers |

The fast part is fast **because it isn't AI**:

- **Allocation + negotiation (0.6 s)** — not a model call. Min-cost assignment over a few dozen
  candidates is a Hungarian/greedy solve; three negotiation rounds re-score a set already in
  memory. The maths is *microseconds*. The 0.6 s is orchestration overhead — activity dispatch,
  state serialisation, history writes.
- **Policy gate (~1 ms)** — OPA/Rego evaluated **in-process**. A remote policy server would be
  ~200 ms and would put a network failure mode on the one component meant to be unbypassable.
- **The other 10.8 s** — GDS book calls. No hardware you buy makes those faster.

**Supplier rate limits are the ceiling, not compute.** Which is why collapsing 300 calls to 102
via the per-route coordinator buys more than any amount of hardware.

---

## 2. Where AI actually lives

| Workload | Hardware | When it runs |
|---|---|---|
| **Cancellation risk model** | **CPU.** Gradient-boosted trees on tabular features — XGBoost/LightGBM territory, not deep learning. | Batch, every 10 min, across the book of live flights |
| **LLM reasoning** (planning, explanation copy) | Hosted API — an API line item, not a GPU you rent | **WARM phase, before the cancellation** — off the critical path |
| **Embeddings / RAG** | Not used | — |

**We do not provision GPUs.** A tabular model scoring a few hundred thousand flights takes seconds
on one modest CPU instance. If someone insists on a GPU it would be for training, occasionally, and
a single spot instance for a few hours a week covers it.

This is the honest answer and it is a *stronger* one than claiming a GPU fleet: it means the unit
economics work at scale.

---

## 3. Scale sizing

Burst target is the **Dec 2025 IndiGo event**: 2,507 cancellations, 3 lakh passengers over 72 h.

| Quantity | Value | Source |
|---|---|---|
| Disruption rate | **1.16 /s** | `3,00,000 ÷ 259,200 s` |
| Temporal persistence load | **~58 writes/s** average | 6-activity saga ≈ 50 history events |
| At 20× burst | **~1,157 writes/s** | Above × 20 |
| Database | **A single well-provisioned PostgreSQL** | **Do not shard** |

`numHistoryShards` is immutable after cluster creation — pick 512 up front. Keep the decision
ledger off the hot path (event bus → warehouse).

If pushed on sharding, the four-part answer is: (1) Temporal shards by workflow ID hash and the
count is fixed at creation; (2) split persistence from *visibility* — "millions of states" is a
visibility-query problem, solved with Elasticsearch/OpenSearch; (3) partition the business database
by **time**, not user, since access is time-clustered and rows go cold in 72 h; (4) **archival to
object storage is the actual scaling lever.**

---

## 4. Deployment shape

```
   Push feeds (flight status, weather)
              │
      ┌───────▼────────┐
      │  Ingest + dedup │   stateless, autoscaled, CPU
      └───────┬────────┘
              │
      ┌───────▼────────┐    ┌──────────────────┐
      │ Risk scorer     │───▶│ Feature store     │   batch, every 10 min, CPU
      └───────┬────────┘    └──────────────────┘
              │ P ≥ 0.25
      ┌───────▼──────────────────────────────┐
      │ Planning layer (LangGraph)            │   cognition only
      │   read-only supplier clients           │   ZERO spend authority
      └───────┬──────────────────────────────┘
              │ every proposal crosses here
      ┌───────▼──────────────────────────────┐
      │ Policy gate — OPA, default deny       │   in-process, ~1 ms
      └───────┬──────────────────────────────┘
              │ allow only
      ┌───────▼──────────────────────────────┐
      │ Durable execution (Temporal)          │   sole owner of side effects
      │   LIFO saga, compensation-before-effect│   retries, timeouts, rollback
      └───────┬──────────────────────────────┘
              │
     Suppliers · payment · notifications
```

**Authority is physically separated.** The planning layer has no network route to a mutating
supplier API. Only a durable-execution activity downstream of an explicit policy allow can touch
inventory or money. One orchestrator, one failure model, one idempotency story.

---

## 5. Rough monthly running cost

At ~50,000 monitored trips/month. Order-of-magnitude, for the business case:

| Line | Estimate | Note |
|---|---|---|
| Flight status feed | $$$ | The dominant cost. Enterprise contract. |
| Weather (NOAA/IMD) | ~$0 | Public feeds |
| Compute (app + workers + scorer) | $300–800 | Ordinary CPU instances |
| PostgreSQL (managed) | $200–500 | Single instance, no sharding |
| LLM API | $150–400 | WARM only, not per-request on the live path |
| Notifications (FCM/SMS/email) | $50–150 | SMS is the variable one |
| Object storage + warehouse | $50–150 | Archived workflows, decision ledger |

**The feed is the budget.** Everything else is rounding. That is the correct thing to negotiate
hard on, and it is a partnership conversation rather than an engineering one.

### 5a. Unit economics: cost per monitored trip, and a scale ladder

Two different things get charged, at two different scales. The §5 table (compute, database, LLM,
notifications, storage — everything except the feed) scales roughly with trip volume: $750–2,000
at ~50,000 trips/month is **$0.015–$0.04 per monitored trip/month**, excluding the flight-status
feed (a fixed enterprise contract, not a per-trip line).

The prediction pipeline specifically (`zkd-risk-model/infra/scoring.tf`, `training.tf`) — the part
this document's "keep the forecast dynamic without a standing endpoint" question is actually
about — is cheap by design, and the cost is computable from the real Terraform config rather than
guessed. At the real `batch_rescore_interval_minutes = 10` default and standard AWS us-east-1
on-demand rate cards (Lambda: $0.20/1M requests + $0.0000166667/GB-s; DynamoDB on-demand:
$1.25/1M writes; Fargate Spot ≈ 30% of on-demand $0.04048/vCPU-hr + $0.004445/GB-hr):

- Assume a trip is actively rescored for the 48h before departure — 288 rescores at the 10-minute
  cadence. Each rescore is one Lambda invocation slice (~1GB memory, ~50ms) plus one DynamoDB
  forecast-cache write: `288 × (0.05 GB-s × $0.0000166667 + $1.25/1e6) ≈ $0.0006/trip/month`.
- The weekly Fargate Spot retrain (~30 min on 2 vCPU/4GB) is a **fixed** cost independent of trip
  volume: `0.5hr × 4.33wk × (2×$0.04048 + 4×$0.004445) × 0.30 ≈ $0.065/month`.
- AppConfig hot-reload reads are negligible at this scale.

| Monitored trips/month | Scoring compute (Lambda + DynamoDB) | + weekly retrain (fixed) | Prediction-pipeline total |
|---|---|---|---|
| 1,000 | ~$0.60 | $0.065 | **~$0.67/month** |
| 10,000 | ~$6.00 | $0.065 | **~$6.10/month** |
| 50,000 | ~$30.00 | $0.065 | **~$30.10/month** |

This is the concrete version of `infra/README.md`'s cost-lever #1: `batch_rescore_interval_minutes`
scales the scoring-compute column roughly linearly — halving it to 5 minutes roughly doubles it;
the demo profile widens it to 15 for exactly this reason. It's also why the design uses batch/event
Lambda rather than a standing SageMaker endpoint (§6): a real-time endpoint bills by the hour
whether or not it's scoring anything, this bills by actual scoring events.

This table prices only the prediction pipeline — not the whole-app baseline (NAT gateway, ALB,
RDS, Fargate app tasks — the fixed ~$25–35/week `terraform.tfvars.demo.example` already estimates)
or the flight-status feed (§5's dominant, fixed line). Figures are computed from public AWS
us-east-1 on-demand rate cards at time of writing, not a real bill — see `infra/README.md`'s own
"cost estimate is not yet a bill" caveat.

---

## 6. Failure modes we have designed for

| Failure | Response |
|---|---|
| Status feed drops a cancellation | Periodic reconcile sweep over the active window catches it — a change-feed alone cannot recover a dropped message |
| Supplier rate-limits us | Per-route coordinator collapses calls; jittered backoff; request coalescing |
| A booking step fails mid-saga | LIFO compensation; async refunds route to escalation rather than being recorded as clean |
| Policy denies every candidate | Change objective to next-day, claim duty of care, escalate |
| The member does not respond | Autopilot proceeds; ask-mode holds. Never ambiguous. |
| Model is badly calibrated | Nothing was ever claimed on it, so the cost is wasted supplier calls; refresh cadence backs off and the band thresholds re-derive |
| Push is throttled (iOS data-only) | Hybrid notification + data payload at `apns-priority: 10`; SMS fallback |

---

## 7. What we have not built

Stated plainly:

- ~~No model of our own to run. The forecast is bought from Lumo.~~ **Superseded** — the
  forecast is now a real, self-trained XGBoost model (`zkd-risk-model/`), batch/event-scored per
  `documentation/design/05-cancellation-risk-model.md` §7 (which also carries this section's
  compute/cost framing forward: no GPU, no standing endpoint, Lambda batch + Fargate Spot retrain).
- **No live supplier integration.** Duffel and LiteAPI sandboxes are the intended proving ground.
- **No real payment rail.** Amex vPayment is mocked behind a contract test.
- **API failure is not modelled** in the simulation — rate limits, timeouts, circuit breakers.
  Given that supplier limits are the binding constraint, this is the most significant gap.
- **Diversion and return-to-gate** are not modelled, though both strand a member.

The prototype demonstrates the *decision architecture* — detection, policy, consent, saga,
rollback. It does not demonstrate supplier integration, and we would rather say so than have it
discovered.
