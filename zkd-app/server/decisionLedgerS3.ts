/**
 * Best-effort mirror of the local hash-chained ledger to S3
 * (DECISION_LEDGER_BUCKET, see zkd-risk-model/infra/app.tf — the same
 * bucket the scoring Lambda already writes to under decision-ledger/, see
 * scoring.tf). Local JSONL is the source of truth for correctness (every
 * caller in server/decisionLedger.ts writes there synchronously); S3 is
 * what makes an entry survive a container restart or redeploy and be
 * readable outside any single ECS task, which app_desired_count >= 1 in
 * prod otherwise loses.
 *
 * Deliberately opt-in and non-blocking: unset DECISION_LEDGER_BUCKET (true
 * for local dev, docker-compose, and any environment without the bucket
 * wired) and this is a no-op — logging must never become a reason a real
 * forecast/decision fails.
 */
import type { S3Client as S3ClientType } from '@aws-sdk/client-s3';

let clientPromise: Promise<S3ClientType> | null = null;

async function getClient(): Promise<S3ClientType> {
  if (!clientPromise) {
    clientPromise = import('@aws-sdk/client-s3').then(
      ({ S3Client }) => new S3Client({ region: process.env.AWS_REGION ?? 'ap-south-1' }),
    );
  }
  return clientPromise;
}

/** `stream` is the ledger name (predictions/outcomes/threshold-evaluations/
 *  policy-decisions/saga-steps) — becomes the S3 key prefix, matching the
 *  local filename per stream so the two are easy to correlate by eye. Each
 *  entry is its own object (not appended) so two ECS tasks writing
 *  concurrently can never race on the same key. */
export function mirrorToS3(stream: string, record: { hash: string; loggedAt: number }): void {
  const bucket = process.env.DECISION_LEDGER_BUCKET;
  if (!bucket) return;

  void (async () => {
    try {
      const client = await getClient();
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const key = `decision-ledger/${stream}/${record.loggedAt}-${record.hash.slice(0, 12)}.json`;
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: JSON.stringify(record),
          ContentType: 'application/json',
        }),
      );
    } catch (e) {
      // Observability, not the critical path — never let an S3 outage
      // affect a real forecast/decision. The local hash-chained file is
      // still the durable, verifiable record either way.
      console.error(`[decisionLedgerS3] failed to mirror ${stream} entry:`, e);
    }
  })();
}
