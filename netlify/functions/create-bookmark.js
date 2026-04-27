// ============================================================
// create-bookmark.js (Netlify Function) — Ad Yaeli bookmark API
//
// POST   /api/bookmark              { name, icon_id }
//                                                       -> create
// GET    /api/bookmark?name=<name>                      -> lookup by name
// GET    /api/bookmark?id=<id>                          -> lookup by id
// GET    /api/bookmark?defaults=1[&theme=<id>]          -> default names for a theme.
//                                                          Returns BOTH:
//                                                            names    — flat ordered list (back-compat)
//                                                            by_icon  — { i01: 'name', ... } for picker UI
//                                                          Names already taken are filtered out
//                                                          of `names` (for autoAssign), but `by_icon`
//                                                          always contains every icon's theme name
//                                                          (so the picker can display the full theme
//                                                          even if some names are claimed).
// GET    /api/bookmark?themes=1                         -> picker metadata:
//                                                          [{ id, label, default? }, ...]
// PUT    /api/bookmark              { id, name?, icon_id?, gate_reached?, max_unlocked? }
//                                                       -> update (rename re-checks
//                                                          uniqueness). gate_reached =
//                                                          furthest gate the reader
//                                                          has unlocked.
//
// Storage:
//   `bookmarks`       — id           -> bookmark record (json)
//   `bookmark-names`  — normalized   -> id (string)
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

// ============================================================
// Themes — each theme is a 1:1 mapping from icon_id to a Hebrew name.
// The picker UI lets the reader switch between themes; whichever
// theme is active just paints the icon labels and powers the
// auto-assign fallback. The icons themselves don't change.
//
// Order in this array determines the order in the picker (first = default).
// ============================================================
const THEMES = [
  {
    id: 'animals',
    label: 'בעלי חיים',
    names: {
      i01: 'ינשוף',     // owl
      i02: 'דוב',       // bear
      i03: 'קואלה',     // koala
      i04: 'עופר',      // fawn
      i05: 'אייל',      // stag
      i06: 'גורילה',    // gorilla
      i07: 'אריה',      // lion
      i08: 'ארנב',      // rabbit
      i09: 'דוב חום',   // brown bear
      i10: 'עצלן',      // sloth
      i11: 'נמר',       // tiger
      i12: 'תנשמת',     // barn owl
      i13: 'תן',        // jackal (was: שועל)
      i14: 'שועל',      // fox
      i15: 'גירית',     // badger
      i16: 'כף יד',     // paw print
      i17: 'כלב',       // dog
      i18: 'חזיר בר',   // boar
      i19: 'פנדה',      // panda
      i20: 'בונה'       // beaver
    }
  },
  {
    id: 'disney',
    label: 'דיסני קלאסי',
    names: {
      i01: 'אול',        // owl  → Owl from Winnie-the-Pooh
      i02: 'פו הדב',     // bear → Winnie-the-Pooh
      i03: 'ננה',        // koala-ish? → Nana (Peter Pan)
      i04: 'במבי',       // fawn → Bambi
      i05: 'פיטר פן',    // stag → Peter Pan (no antlers, but evocative)
      i06: 'גופי',       // gorilla-ish → Goofy
      i07: 'סימבא',      // lion → Simba
      i08: 'רוג\'ר ראביט',// rabbit → Roger Rabbit
      i09: 'בלאו',       // brown bear → Baloo (Jungle Book)
      i10: 'אולף',       // sloth → Olaf (Frozen)
      i11: 'טייגר',      // tiger → Tigger
      i12: 'אריאל',      // barn owl → Ariel
      i13: 'דונלד',      // small canid → Donald Duck
      i14: 'דייזי',      // fox → Daisy Duck
      i15: 'סטיץ\'',     // badger-ish → Stitch
      i16: 'מיקי מאוס',  // paw → Mickey Mouse
      i17: 'פלוטו',      // dog → Pluto
      i18: 'פומבה',      // boar → Pumbaa
      i19: 'דמבו',       // panda-ish → Dumbo
      i20: 'מיני'        // beaver-ish → Minnie
    }
  },
  {
    id: 'sports',
    label: 'אגדות הספורט',
    names: {
      i01: 'ברקוביץ\'',  // owl  → "the brain" of Israeli basketball
      i02: 'אוחנה',
      i03: 'שלף',
      i04: 'רביבו',
      i05: 'בנין',
      i06: 'שארפ',       // gorilla → Joe Sharp, raw power
      i07: 'זהבי',       // lion   → Eran Zahavi, top scorer
      i08: 'בניון',      // rabbit → Yaniv Banayan, speed
      i09: 'קטש',
      i10: 'גורדון',
      i11: 'שפר',        // (Doron Sharf, was: שפר (דורון שפר))
      i12: 'גינצבורג',
      i13: 'ג\'מצ\'י',
      i14: 'חרזי',
      i15: 'גרשון',
      i16: 'דניאל',
      i17: 'רוזנטל',
      i18: 'בורשטיין',
      i19: 'פליישר',
      i20: 'מזרחי'
    }
  }
];

const ALL_ICON_IDS = Array.from({ length: 20 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`);
const PICKER_SLOTS = 20;

function findTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

// Build the full picker payload for a given theme:
//   names    — flat list, ordered by icon_id, with claimed names filtered out
//              (auto-assign loops over this list trying each one)
//   by_icon  — { i01: 'name', ... } — full theme mapping, including claimed names
//              (picker UI uses this to paint the icon labels regardless of
//              who's already claimed which name)
async function getSuggestedDefaults(namesStore, themeId) {
  const theme = findTheme(themeId);

  // Read all claimed names. Blob list keys ARE the normalized names.
  const claimedSet = new Set();
  try {
    const { blobs } = await namesStore.list();
    for (const b of (blobs || [])) claimedSet.add(b.key);
  } catch (e) {
    // If list fails (e.g. cold store), fall back to empty — still safe.
  }

  const by_icon = {};
  const flat = [];
  for (const iid of ALL_ICON_IDS) {
    const n = theme.names[iid];
    if (!n) continue;
    by_icon[iid] = n;
    if (!claimedSet.has(normalize(n)) && !flat.includes(n)) {
      flat.push(n);
    }
  }
  return {
    theme: theme.id,
    label: theme.label,
    names: flat,
    by_icon,
    slots: PICKER_SLOTS
  };
}

function getThemesMeta() {
  return THEMES.map((t, i) => ({
    id: t.id,
    label: t.label,
    default: i === 0
  }));
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS });
  }

  const bookmarks = getStore('bookmarks');
  const names = getStore('bookmark-names');
  const url = new URL(req.url);

  try {
    // ---------- GET — lookup or defaults ----------
    if (req.method === 'GET') {
      const q = url.searchParams;

      // Themes metadata for the picker UI
      if (q.get('themes') === '1') {
        return json({ themes: getThemesMeta() });
      }

      // Smart defaults — must come first so it's not mistaken for a lookup
      if (q.get('defaults') === '1') {
        const themeId = q.get('theme') || THEMES[0].id;
        const payload = await getSuggestedDefaults(names, themeId);
        return json(payload);
      }

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
        gate_reached: 0,        // furthest "להמשיך לקרוא" gate this reader has unlocked
        gate_times: {},         // map of gate number -> epoch ms when cleared
        max_unlocked: 4,        // legacy field — kept for back-compat, not used by new gates
        reactions: {}
      };
      await bookmarks.setJSON(id, bm);
      await names.set(norm, id);
      return json(bm);
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

      const allowed = ['name', 'icon_id', 'gate_reached', 'max_unlocked', 'reactions'];
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
