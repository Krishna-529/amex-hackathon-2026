import { NextRequest, NextResponse } from 'next/server';
import { opsSessionFrom } from '@/server/auth/opsSession';

/** Lets the /ops page ask "am I already signed in as an operator" on load,
 *  without the confusion of reusing requireOperator's 401-as-signal shape
 *  from client code. */
export async function GET(req: NextRequest) {
  const session = opsSessionFrom(req);
  return NextResponse.json({ signedIn: session !== null });
}
