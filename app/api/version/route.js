// The release currently live, so tabs left open on an older release
// can refresh themselves.
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(
    { version: process.env.VERCEL_GIT_COMMIT_SHA || 'dev' },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
