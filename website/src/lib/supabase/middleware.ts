import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export async function updateSession(request: NextRequest) {
  return NextResponse.next({ request });
}
