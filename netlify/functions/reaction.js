// ============================================================
// reaction.js (Netlify Function) — Reader reactions API
//
// POST   /api/reaction
//   { bookmark_id, reaction, scope, text, anchor_id }
//   -> create reaction. Returns the saved record.
//
// DELETE /api/reaction?bookmark_id=<bid>&id=<rid>
//   -> remove a single reaction (used by the "reset" button).
//
// GET    /api/reaction?bookmark_id=<bid>
//   -> list all reactions belonging to one bookmark, so the
//      reader sees their own highlights when they reopen the book
//      from a different device.
//
// Storage: blob store `reactions`, keyed by `${bookmark_id}:${id}`
// so listing one user's reactions is a single prefix scan.
// ============================================================

import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS }
  });

const uuid = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'r_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
};

const VALID_REACTIONS = new Set(['love', 'improve']);
const VALID_SCOPES = new Set(['word', 'paragraph', 'scene']);

const composeKey = (bookmark_id, id) => `${bookmark_id}:${id}`;

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS });
  }

  const reactions = getStore('reactions');
  const bookmarks = getStore('bookmarks');
  const url = new URL(req.url);

  try {
    // ---------- GET — list for one bookmark ----------
    if (req.method === 'GET') {
      const bookmark_id = url.searchParams.get('bookmark_id');
      if (!bookmark_id) return json({ error: 'missing_bookmark_id' }, 400);

      const { blobs } = await reactions.list({ prefix: `${bookmark_id}:` });
      const out = [];
      for (const b of (blobs || [])) {
        const rec = await reactions.get(b.key, { type: 'json' });
        if (rec) out.push(rec);
      }
      // Newest first
      out.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      return json({ reactions: out });
    }

    // ---------- POST — create ----------
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const bookmark_id = (body.bookmark_id || '').toString().trim();
      const reaction = (body.reaction || '').toString().trim();
      const scope = (body.scope || '').toString().trim();
      const text = (body.text || '').toString();
      const anchor_id = (body.anchor_id || '').toString().trim();

      if (!bookmark_id) return json({ error: 'missing_bookmark_id' }, 400);
      if (!VALID_REACTIONS.has(reaction)) return json({ error: 'invalid_reaction' }, 400);
      if (!VALID_SCOPES.has(scope)) return json({ error: 'invalid_scope' }, 400);
      if (!text) return json({ error: 'missing_text' }, 400);
      if (!anchor_id) return json({ error: 'missing_anchor_id' }, 400);

      // Denormalize bookmark name onto the reaction so the dashboard
      // never has to join across stores.
      const bm = await bookmarks.get(bookmark_id, { type: 'json' });
      if (!bm) return json({ error: 'bookmark_not_found' }, 404);

      const id = uuid();
      const rec = {
        id,
        bookmark_id,
        bookmark_name: bm.name || '',
        reaction,
        scope,
        text,
        anchor_id,
        created_at: Date.now()
      };
      await reactions.setJSON(composeKey(bookmark_id, id), rec);
      return json(rec);
    }

    // ---------- DELETE — remove a single reaction ----------
    if (req.method === 'DELETE') {
      const bookmark_id = url.searchParams.get('bookmark_id');
      const id = url.searchParams.get('id');
      if (!bookmark_id || !id) return json({ error: 'missing_params' }, 400);
      await reactions.delete(composeKey(bookmark_id, id));
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (e) {
    return json({ error: 'server_error', message: String(e && e.message || e) }, 500);
  }
};

export const config = {
  path: '/api/reaction'
};
