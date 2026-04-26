// ============================================================
// reaction.js (Netlify Function) — Reader feedback API
//
// One record per (bookmark_id, anchor_id). Each record can hold a
// reaction, a free-text comment, or both — modeling the "bigger
// feedback sample" where an icon (אהבתי/לשפר) and the reader's
// own words can mark the same highlighted passage.
//
// POST   /api/reaction
//   { bookmark_id, anchor_id, scope, text, reaction?, comment? }
//   - Upsert. Existing record is merged: any field you pass replaces,
//     anything you omit stays.
//   - At least one of reaction / comment must be present.
//   - On a brand-new record, scope + text are required.
//   - reaction values: "love" | "improve"  (internal codes; the UI
//     surfaces them as אהבתי / לשפר with their own icons)
//
// DELETE /api/reaction?bookmark_id=<bid>&anchor_id=<aid>
//   - Removes the entire record (the ↶ reset button).
//
// GET    /api/reaction?bookmark_id=<bid>
//   - List this reader's records, newest first. Used to repaint
//     highlights when the reader returns from another device.
//
// Storage: blob store `reactions`, key = `${bookmark_id}:${anchor_id}`
// (deterministic — makes upserts trivial).
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

const composeKey = (bookmark_id, anchor_id) => `${bookmark_id}:${anchor_id}`;

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
      out.sort((a, b) => (b.updated_at || b.created_at || 0) - (a.updated_at || a.created_at || 0));
      return json({ reactions: out });
    }

    // ---------- POST — upsert ----------
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const bookmark_id = (body.bookmark_id || '').toString().trim();
      const anchor_id = (body.anchor_id || '').toString().trim();

      if (!bookmark_id) return json({ error: 'missing_bookmark_id' }, 400);
      if (!anchor_id) return json({ error: 'missing_anchor_id' }, 400);

      // Pull current record (if any) so we can merge.
      const key = composeKey(bookmark_id, anchor_id);
      const existing = await reactions.get(key, { type: 'json' });

      // Required fields differ between create and update.
      const incomingReaction = body.reaction !== undefined ? String(body.reaction).trim() : undefined;
      const incomingComment = body.comment !== undefined ? String(body.comment) : undefined;

      // Validate reaction value if provided
      if (incomingReaction !== undefined && incomingReaction !== '' && !VALID_REACTIONS.has(incomingReaction)) {
        return json({ error: 'invalid_reaction' }, 400);
      }

      // Must contribute *something* — either a reaction or a comment.
      const hasReaction = incomingReaction !== undefined && incomingReaction !== '';
      const hasComment = incomingComment !== undefined && incomingComment.trim() !== '';
      if (!existing && !hasReaction && !hasComment) {
        return json({ error: 'missing_payload' }, 400);
      }

      let scope, text, bookmark_name, id, created_at;
      if (existing) {
        scope = existing.scope;
        text = existing.text;
        bookmark_name = existing.bookmark_name;
        id = existing.id;
        created_at = existing.created_at;
      } else {
        // Brand-new record requires scope + text.
        scope = (body.scope || '').toString().trim();
        text = (body.text || '').toString();
        if (!VALID_SCOPES.has(scope)) return json({ error: 'invalid_scope' }, 400);
        if (!text) return json({ error: 'missing_text' }, 400);
        const bm = await bookmarks.get(bookmark_id, { type: 'json' });
        if (!bm) return json({ error: 'bookmark_not_found' }, 404);
        bookmark_name = bm.name || '';
        id = uuid();
        created_at = Date.now();
      }

      // Merge fields: anything explicitly passed wins; missing fields stay.
      const merged = {
        id,
        bookmark_id,
        bookmark_name,
        anchor_id,
        scope,
        text,
        reaction: existing ? existing.reaction || null : null,
        comment: existing ? existing.comment || '' : '',
        created_at,
        updated_at: Date.now()
      };
      if (incomingReaction !== undefined) merged.reaction = incomingReaction || null;
      if (incomingComment !== undefined) merged.comment = incomingComment;

      // Don't allow a record to end up with neither (dashboard would have nothing to show).
      const finalHasReaction = !!merged.reaction;
      const finalHasComment = (merged.comment || '').trim() !== '';
      if (!finalHasReaction && !finalHasComment) {
        // Treat this as a delete — record is empty, drop it.
        await reactions.delete(key);
        return json({ deleted: true, anchor_id });
      }

      await reactions.setJSON(key, merged);
      return json(merged);
    }

    // ---------- DELETE — drop the whole record ----------
    if (req.method === 'DELETE') {
      const bookmark_id = url.searchParams.get('bookmark_id');
      const anchor_id = url.searchParams.get('anchor_id') || url.searchParams.get('id');
      if (!bookmark_id || !anchor_id) return json({ error: 'missing_params' }, 400);
      await reactions.delete(composeKey(bookmark_id, anchor_id));
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
