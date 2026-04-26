// ============================================================
// admin-progress.js (Netlify Function) — Reader progress dashboard feed
//
// GET    /api/admin/progress
// Header: x-admin-key: <ADMIN_KEY env var>
//
// Returns a JSON list of every bookmark with progress fields,
// sorted by last_seen_at desc (most recently active first).
//
// This endpoint feeds the Base44 author dashboard. It is gated by
// a single shared secret stored as the ADMIN_KEY environment
// variable on Netlify. Without a matching x-admin-key header the
// endpoint returns 401.
// ============================================================

import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-admin-key',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
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
  if (req.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  // ---- Auth ----
  const expected = process.env.ADMIN_KEY;
  const provided = req.headers.get('x-admin-key');
  if (!expected) {
    return json({ error: 'admin_key_not_configured' }, 500);
  }
  if (provided !== expected) {
    return json({ error: 'unauthorized' }, 401);
  }

  // ---- Pull all bookmarks ----
  try {
    const bookmarks = getStore('bookmarks');
    const { blobs } = await bookmarks.list();
    const out = [];
    for (const b of (blobs || [])) {
      const bm = await bookmarks.get(b.key, { type: 'json' });
      if (!bm) continue;
      const gt = (bm.gate_times && typeof bm.gate_times === 'object') ? bm.gate_times : {};
      out.push({
        id: bm.id,
        name: bm.name,
        icon_id: bm.icon_id,
        gate_reached: typeof bm.gate_reached === 'number' ? bm.gate_reached : 0,
        created_at: bm.created_at || null,
        last_seen_at: bm.last_seen_at || null,
        // Object form (forward-compat as more gates are added):
        gate_times: gt,
        // Flat fields for easy column-mapping in the dashboard:
        gate_1_at: typeof gt[1] === 'number' ? gt[1] : null,
        gate_2_at: typeof gt[2] === 'number' ? gt[2] : null,
        gate_3_at: typeof gt[3] === 'number' ? gt[3] : null,
        // Gate 4 = book completion ("סיימתי!" button)
        gate_4_at: typeof gt[4] === 'number' ? gt[4] : null,
        completed_at: typeof gt[4] === 'number' ? gt[4] : null
      });
    }

    // Most recently active first
    out.sort((a, b) => (b.last_seen_at || 0) - (a.last_seen_at || 0));

    return json({
      count: out.length,
      bookmarks: out,
      generated_at: Date.now()
    });
  } catch (e) {
    return json({ error: 'server_error', message: String(e && e.message || e) }, 500);
  }
};

export const config = {
  path: '/api/admin/progress'
};
