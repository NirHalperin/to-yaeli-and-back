// ============================================================
// admin-reactions.js (Netlify Function) — Feedback dashboard feed
//
// GET    /api/admin/reactions
// Header: x-admin-key: <ADMIN_KEY env var>
//
// Returns every feedback record across every bookmark, newest first.
// One record per (bookmark_id, anchor_id) — each can carry a reaction,
// a free-text comment, or both, all marking the same highlighted span.
//
// Each row carries:
//   - reaction          ("love" | "improve" | null)
//   - reaction_label    ("אהבתי" | "לשפר" | null)
//   - reaction_icon_url ("/Love%20It.png" | "/Make%20Better.png" | null)
//   - comment           the reader's free text (string, may be "")
//   - has_text          true if comment is non-empty (handy column for filtering)
//   - display_text      what they highlighted (scenes truncated to first sentence)
//   - text_full         untruncated original highlight
//   - bookmark_name     the "who" column
//   - bookmark_id
//   - scope             ("word" | "paragraph" | "scene")
//   - anchor_id
//   - created_at        first-saved time, epoch ms
//   - updated_at        last-edited time, epoch ms (sort key)
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

// Map internal storage codes -> what the reader actually saw on the page.
// Storage stays in English ("love" / "improve") for URL/code safety; the
// dashboard gets the Hebrew label + the real icon image so the table
// looks identical to the in-book popup.
const REACTION_LABEL = {
  love: 'אהבתי',
  improve: 'לשפר'
};
const REACTION_ICON = {
  love: '/Love%20It.png',
  improve: '/Make%20Better.png'
};

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
      const reaction = r.reaction || null;
      const comment = (r.comment || '').toString();
      out.push({
        id: r.id,
        reaction,
        reaction_label: reaction ? (REACTION_LABEL[reaction] || reaction) : null,
        reaction_icon_url: reaction ? (REACTION_ICON[reaction] || null) : null,
        comment,
        has_text: comment.trim() !== '',
        scope: r.scope,
        display_text,
        text_full: r.text || '',
        bookmark_name: r.bookmark_name || '',
        bookmark_id: r.bookmark_id || '',
        anchor_id: r.anchor_id || '',
        created_at: r.created_at || null,
        updated_at: r.updated_at || r.created_at || null
      });
    }

    // Newest activity first — updated_at picks up edits, falls back to created_at.
    out.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));

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
