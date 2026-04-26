// ============================================================
// bookmark-progress.js (Netlify Function) — Reader gate progress
//
// POST /api/bookmark/progress  { bookmark_id, gate_reached }
//   -> updates the bookmark's gate_reached MONOTONICALLY:
//      only writes if gate_reached > current value.
//      Always refreshes last_seen_at so the reader appears
//      "active" in the dashboard even on no-op updates.
//
// Returns: the (possibly unchanged) bookmark record.
//
// Why a dedicated endpoint (vs reusing PUT /api/bookmark)?
//   - Monotonic invariant (no rewinding) belongs in one place.
//   - Lets us instrument / log gate-clearing events separately.
//   - Smaller, narrower API surface for the client to call.
// ============================================================

import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS }
  });

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const body = await req.json().catch(() => ({}));
  const bookmark_id = (body.bookmark_id || '').toString().trim();
  const gate_reached_raw = body.gate_reached;
  const gate_reached = Number(gate_reached_raw);

  if (!bookmark_id) return json({ error: 'missing_bookmark_id' }, 400);
  if (!Number.isFinite(gate_reached) || gate_reached < 0) {
    return json({ error: 'invalid_gate_reached' }, 400);
  }

  try {
    const bookmarks = getStore('bookmarks');
    const bm = await bookmarks.get(bookmark_id, { type: 'json' });
    if (!bm) return json({ error: 'not_found' }, 404);

    const current = typeof bm.gate_reached === 'number' ? bm.gate_reached : 0;
    if (gate_reached > current) {
      bm.gate_reached = gate_reached;
    }
    bm.last_seen_at = Date.now();

    await bookmarks.setJSON(bookmark_id, bm);
    return json(bm);
  } catch (e) {
    return json({ error: 'server_error', message: String(e && e.message || e) }, 500);
  }
};

export const config = {
  path: '/api/bookmark/progress'
};
