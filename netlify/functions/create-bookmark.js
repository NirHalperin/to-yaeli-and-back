// ============================================================
// bookmark.js (Netlify Function) — Ad Yaeli bookmark API
//
// POST   /api/bookmark                   { name, icon_id }          -> create
// GET    /api/bookmark?name=<name>                                  -> lookup by name
// GET    /api/bookmark?id=<id>                                      -> lookup by id
// PUT    /api/bookmark                   { id, name?, icon_id?, max_unlocked? }
//                                                                   -> update (rename re-checks uniqueness)
//
// Uniqueness: normalize(name) -> id  lives in the `bookmark-names` blob store.
// Bookmarks themselves live in the `bookmarks` blob store, keyed by id.
// ============================================================

import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS }
  });

const normalize = (s) =>
  (s || '').toString().trim().toLocaleLowerCase().replace(/\s+/g, ' ');

const uuid = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'bm_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
};

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS });
  }

  const bookmarks = getStore('bookmarks');
  const names = getStore('bookmark-names');
  const url = new URL(req.url);

  try {
    // ---------- POST — create ----------
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const name = (body.name || '').toString().trim();
      const icon_id = (body.icon_id || '').toString().trim();
      if (!name || !icon_id) return json({ error: 'missing_fields' }, 400);

      const norm = normalize(name);
      const existing = await names.get(norm);
      if (existing) return json({ error: 'name_taken' }, 409);

      const id = uuid();
      const bm = {
        id,
        name,
        icon_id,
        created_at: Date.now(),
        last_seen_at: Date.now(),
        max_unlocked: 4,
        reactions: {}
      };
      await bookmarks.setJSON(id, bm);
      await names.set(norm, id);
      return json(bm);
    }

    // ---------- GET — lookup ----------
    if (req.method === 'GET') {
      const q = url.searchParams;
      const name = q.get('name');
      const id = q.get('id');

      if (name) {
        const norm = normalize(name);
        const bid = await names.get(norm);
        if (!bid) return json({ error: 'not_found' }, 404);
        const bm = await bookmarks.get(bid, { type: 'json' });
        if (!bm) return json({ error: 'not_found' }, 404);
        bm.last_seen_at = Date.now();
        await bookmarks.setJSON(bid, bm);
        return json(bm);
      }
      if (id) {
        const bm = await bookmarks.get(id, { type: 'json' });
        if (!bm) return json({ error: 'not_found' }, 404);
        return json(bm);
      }
      return json({ error: 'missing_query' }, 400);
    }

    // ---------- PUT — update ----------
    if (req.method === 'PUT') {
      const body = await req.json().catch(() => ({}));
      const { id, ...updates } = body;
      if (!id) return json({ error: 'missing_id' }, 400);

      const bm = await bookmarks.get(id, { type: 'json' });
      if (!bm) return json({ error: 'not_found' }, 404);

      // Rename with uniqueness check
      if (updates.name && normalize(updates.name) !== normalize(bm.name)) {
        const newNorm = normalize(updates.name);
        const conflict = await names.get(newNorm);
        if (conflict && conflict !== id) return json({ error: 'name_taken' }, 409);
        await names.delete(normalize(bm.name));
        await names.set(newNorm, id);
      }

      const allowed = ['name', 'icon_id', 'max_unlocked', 'reactions'];
      for (const k of allowed) {
        if (updates[k] !== undefined) bm[k] = updates[k];
      }
      bm.last_seen_at = Date.now();

      await bookmarks.setJSON(id, bm);
      return json(bm);
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (e) {
    return json({ error: 'server_error', message: String(e && e.message || e) }, 500);
  }
};

export const config = {
  path: '/api/bookmark'
};
