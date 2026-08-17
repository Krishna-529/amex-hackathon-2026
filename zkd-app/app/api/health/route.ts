import { NextResponse } from 'next/server';

/**
 * The ALB target group's health check (infra/execution-plane and
 * zkd-risk-model/infra/app.tf's `aws_lb_target_group.app` both point here).
 * Deliberately shallow — this answers "is the Node process alive and
 * serving", not "is Postgres/Temporal/OPA reachable"; a downstream outage
 * should show up as a degraded feature in the UI, not take zkd-app itself
 * out of the ALB's rotation.
 */
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'zkd-app', now: Date.now() });
}
