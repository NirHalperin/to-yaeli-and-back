// ============================================================
// admin-reactions.js (Netlify Function) — Reactions dashboard feed
//
// GET    /api/admin/reactions
// Header: x-admin-key: <ADMIN_KEY env var>
//
// Returns every reaction across every bookmark, newest first.
// Each row carries:
//   - reaction          ("love" | "improve")
//   - display_text      (full text, except scenes are truncated to first sentence)
//   - text_full         (untruncated original)
//   - bookmark_name     (the "who" column)
//   - bookmark_id
//   - scope             (word | paragraph | scene)
//   - anchor_id
//   - created_at        (epoch ms — Base44 can format this column-side)
//
// This endpoint feeds the Base44 author dashboard. Same x-admin-key
// auth model as /api/admin/progress.
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

// First-sentence extraction. Hebrew sentence-enders include
// the standard Latin set plus the upper-quote ״ (gershayim) and
// the colon-like ׃ (sof pasuq), with … for trailing ellipsis.
function firstSentence(text) {
  if (!text) return '';
  const m = String(text).match(/^[\s\S]*?[.!?״׃…]/);
  return m ? m[0].trim() : String(text).trim();
}

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
  if (!expected) return json({ error: 'admin_key_not_configured' }, 500);
  if (provided !== expected) return json({ error: 'unauthorized' }, 401);

  try {
    const reactions = getStore('reactions');
    const { blobs } = await reactions.list();
    const out = [];
    for (const b of (blobs || [])) {
      const r = await reactions.get(b.key, { type: 'json' });
      if (!r) continue;
      const display_text = r.scope === 'scene' ? firstSentence(r.text) : (r.text || '');
      out.push({
        id: r.id,
        reaction: r.reaction,
        scope: r.scope,
        display_text,
        text_full: r.text || '',
        bookmark_name: r.bookmark_name || '',
        bookmark_id: r.bookmark_id || '',
        anchor_id: r.anchor_id || '',
        created_at: r.created_at || null
      });
    }

    out.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    return json({
      count: out.length,
      reactions: out,
      generated_at: Date.now()
    });
  } catch (e) {
    return json({ error: 'server_error', message: String(e && e.message || e) }, 500);
  }
};

export const config = {
  path: '/api/admin/reactions'
};
