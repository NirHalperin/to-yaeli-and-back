/* ===================================================================
   feedback.js — drop-in widget for the Ad Yaeli feedback layer.

   Any page that loads this script will auto-activate on every
   <article class="story feedback-enabled"> it finds.

   Persistence:
     - Reactions are saved to /api/reaction (POST/DELETE/GET).
     - Identity comes from bookmark.js — we read it via
       window.__bmGetState() and ensure it exists by calling
       window.__bmEnsureBookmark() (which auto-assigns on dismiss).
     - On page load (and on every "bm:identity-changed" event) we
       refetch this user's reactions and re-paint the .committed
       highlights so they survive across devices.
   =================================================================== */

(function () {
  const REACTION_API = '/api/reaction';

  const stories = document.querySelectorAll('.story.feedback-enabled');
  if (stories.length === 0) return;

  /* ---------- 1. Wrap every word in <span class="word"> + stamp anchor IDs ----------
     Anchor ID format: "p<paragraphIdx>w<wordIdx>" — stable as long as
     the source text doesn't shift around. Lets us re-paint highlights
     on reload by querying [data-anchor-id="..."]. */
  stories.forEach((story) => {
    const paragraphs = Array.from(story.querySelectorAll('p:not(.break)'));
    paragraphs.forEach((p, pIdx) => {
      if (p.dataset.fbWrapped === '1') return;
      const original = p.textContent;
      p.textContent = '';
      const tokens = original.split(/(\s+)/);
      let wIdx = 0;
      tokens.forEach((tok) => {
        if (tok === '') return;
        if (/^\s+$/.test(tok)) {
          p.appendChild(document.createTextNode(tok));
        } else {
          const span = document.createElement('span');
          span.className = 'word';
          span.dataset.anchorId = `p${pIdx}w${wIdx}`;
          span.textContent = tok;
          p.appendChild(span);
          wIdx++;
        }
      });
      p.dataset.fbWrapped = '1';
      p.dataset.fbParaIdx = String(pIdx);
    });
  });

  /* ---------- 2. State ---------- */
  let popup = null;
  let anchorWord = null;
  let scope = null;
  let editingAnchor = null;
  // Map<anchorEl, { reaction, scope, id }>  — `id` is the server-side reaction id.
  const reactions = new Map();
  let busy = false;  // simple in-flight guard so double-clicks don't double-save

  /* ---------- 3. Scope helpers ---------- */
  function getParagraphOf(wordEl) { return wordEl.closest('p'); }

  /**
   * 3rd-tap scope: the word's paragraph PLUS up to 3 preceding paragraphs,
   * bounded by the chapter break (<p class="break">). Never crosses a break.
   */
  function getSceneParagraphs(paragraph) {
    const story = paragraph.parentElement;
    const kids = Array.from(story.children);
    const idx = kids.indexOf(paragraph);
    const MAX_BACK = 3;
    const collected = [paragraph];
    let back = 0;
    let i = idx - 1;
    while (i >= 0 && back < MAX_BACK) {
      if (kids[i].classList.contains('break')) break;
      collected.unshift(kids[i]);
      back++;
      i--;
    }
    return collected;
  }

  function getScopeWords(anchor, scopeName) {
    if (scopeName === 'word') return [anchor];
    const para = getParagraphOf(anchor);
    if (scopeName === 'paragraph') return Array.from(para.querySelectorAll('.word'));
    if (scopeName === 'scene') {
      return getSceneParagraphs(para).flatMap((p) => Array.from(p.querySelectorAll('.word')));
    }
    return [];
  }

  /* Capture the actual text the reader highlighted, so it lands in the
     dashboard exactly as written. We use textContent at the paragraph
     level (or concatenated paragraphs for a scene) to preserve original
     punctuation/whitespace — joining individual word spans drops
     niceties like commas-before-spaces. */
  function getScopeText(anchor, scopeName) {
    if (scopeName === 'word') return (anchor.textContent || '').trim();
    const para = getParagraphOf(anchor);
    if (scopeName === 'paragraph') return (para.textContent || '').trim();
    if (scopeName === 'scene') {
      return getSceneParagraphs(para).map((p) => (p.textContent || '').trim()).join('\n\n');
    }
    return '';
  }

  /* ---------- 4. Target (transient selection) visuals ---------- */
  function applyTarget(anchor, scopeName) {
    clearTarget();
    getScopeWords(anchor, scopeName).forEach((w) => w.classList.add('target'));
  }
  function clearTarget() {
    document.querySelectorAll('.word.target').forEach((w) => w.classList.remove('target'));
  }

  /* ---------- 5. Commit / reset (permanent visuals) ---------- */
  function applyCommitted(anchor, scopeName) {
    getScopeWords(anchor, scopeName).forEach((w) => w.classList.add('committed'));
  }
  function removeCommitted(anchor, scopeName) {
    getScopeWords(anchor, scopeName).forEach((w) => w.classList.remove('committed'));
  }

  function findCommittedFor(wordEl) {
    for (const [anchor, data] of reactions.entries()) {
      const words = getScopeWords(anchor, data.scope);
      if (words.includes(wordEl)) return { anchor, data };
    }
    return null;
  }

  function clearAllCommitted() {
    document.querySelectorAll('.word.committed').forEach((w) => w.classList.remove('committed'));
    reactions.clear();
  }

  /* ---------- 6. Popup ---------- */
  function openPopup(options = {}) {
    closePopupDom();
    popup = document.createElement('div');
    popup.className = 'fb-popup';
    const currentReaction = options.currentReaction || null;
    const isEditing = !!options.isEditing;

    popup.innerHTML = `
      <div class="fb-row">
        <button class="fb-btn fb-btn-reaction ${currentReaction === 'love' ? 'selected' : ''}"
                data-action="love" aria-label="אהבתי">
          <img src="Love It.png" alt="אהבתי" draggable="false" />
        </button>
        <button class="fb-btn fb-btn-reaction ${currentReaction === 'improve' ? 'selected' : ''}"
                data-action="improve" aria-label="לשפר">
          <img src="Make Better.png" alt="לשפר" draggable="false" />
        </button>
        <div class="fb-divider"></div>
        <button class="fb-btn fb-btn-secondary fb-btn-reset"
                data-action="reset" aria-label="איפוס"
                ${currentReaction ? '' : 'disabled'}>
          <svg viewBox="0 0 24 24">
            <path d="M3 12a9 9 0 1 0 3-6.7"/>
            <polyline points="3 4 3 10 9 10"/>
          </svg>
        </button>
        <button class="fb-btn fb-btn-secondary fb-btn-close"
                data-action="close" aria-label="סגור">
          <svg viewBox="0 0 24 24">
            <path d="M6 6L18 18M18 6L6 18"/>
          </svg>
        </button>
      </div>
      ${isEditing ? '' : `
      <div class="fb-hint">
        <svg class="fb-hint-icon" viewBox="0 0 24 24">
          <path d="m9 11-6 6v3h9l3-3"/>
          <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>
        </svg>
        <span>לחץ שוב על המילה בשביל להרחיב את הבחירה.</span>
      </div>
      `}
    `;
    document.body.appendChild(popup);
    positionPopup();
    requestAnimationFrame(() => popup.classList.add('visible'));
    popup.addEventListener('click', onPopupClick);
  }

  function closePopupDom() {
    if (popup) {
      popup.remove();
      popup = null;
    }
  }

  function positionPopup() {
    if (!popup || !anchorWord) return;
    const rect = anchorWord.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const margin = 8;

    let top = window.scrollY + rect.bottom + 16;
    let left = window.scrollX + rect.left + rect.width / 2 - popupRect.width / 2;

    if (left < window.scrollX + margin) left = window.scrollX + margin;
    const maxLeft = window.scrollX + window.innerWidth - popupRect.width - margin;
    if (left > maxLeft) left = maxLeft;

    const viewportBottom = window.scrollY + window.innerHeight;
    if (top + popupRect.height + margin > viewportBottom) {
      top = window.scrollY + rect.top - popupRect.height - 16;
      popup.classList.add('fb-above');
    }

    popup.style.top = top + 'px';
    popup.style.left = left + 'px';

    const arrowCenter = (window.scrollX + rect.left + rect.width / 2) - left;
    popup.style.setProperty('--arrow-left', (arrowCenter - 10) + 'px');
  }

  /* ---------- 7. Popup actions ---------- */
  function onPopupClick(e) {
    const btn = e.target.closest('.fb-btn');
    if (!btn) return;
    e.stopPropagation();
    const action = btn.dataset.action;

    if (action === 'love' || action === 'improve') commitReaction(action);
    else if (action === 'reset') resetReaction();
    else if (action === 'close') closeSelection();
  }

  /* ---------- 8. API helpers ---------- */
  function getBookmarkState() {
    if (typeof window.__bmGetState === 'function') return window.__bmGetState();
    return null;
  }

  async function ensureBookmark() {
    const cur = getBookmarkState();
    if (cur && cur.bookmark_id) return cur;
    if (typeof window.__bmEnsureBookmark === 'function') {
      return await window.__bmEnsureBookmark();
    }
    throw new Error('bookmark_unavailable');
  }

  async function apiCreateReaction({ bookmark_id, reaction, scope, text, anchor_id }) {
    const res = await fetch(REACTION_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookmark_id, reaction, scope, text, anchor_id })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'api_error');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function apiDeleteReaction({ bookmark_id, id }) {
    const url = `${REACTION_API}?bookmark_id=${encodeURIComponent(bookmark_id)}&id=${encodeURIComponent(id)}`;
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.error || 'api_error');
      err.status = res.status;
      throw err;
    }
    return true;
  }

  async function apiListReactions(bookmark_id) {
    const res = await fetch(`${REACTION_API}?bookmark_id=${encodeURIComponent(bookmark_id)}`);
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data.reactions) ? data.reactions : [];
  }

  /* ---------- 9. Commit + reset (now persisted) ---------- */
  async function commitReaction(reaction) {
    if (busy) return;
    if (!anchorWord || !scope) return;
    busy = true;

    // Snapshot the working selection before the modal flow
    // potentially nukes them via DOM churn or focus changes.
    const localAnchor = anchorWord;
    const localScope = scope;
    const localEditing = editingAnchor;
    const text = getScopeText(localAnchor, localScope);
    const anchor_id = localAnchor.dataset.anchorId || '';

    let bm;
    try {
      bm = await ensureBookmark();
    } catch (e) {
      busy = false;
      return; // user couldn't get a bookmark — bail silently
    }

    // If editing an existing reaction → delete the old one first.
    let oldRecord = null;
    if (localEditing && reactions.has(localEditing)) {
      oldRecord = reactions.get(localEditing);
    }

    try {
      const saved = await apiCreateReaction({
        bookmark_id: bm.bookmark_id,
        reaction,
        scope: localScope,
        text,
        anchor_id
      });

      if (oldRecord) {
        // Best-effort: remove the previous server record. We don't
        // block the UX on this; if it fails, the user has a duplicate
        // server-side which the dashboard will show — we'll fix on
        // reload, since the in-memory map only points at the new one.
        try {
          await apiDeleteReaction({ bookmark_id: bm.bookmark_id, id: oldRecord.id });
        } catch (_) {}
        removeCommitted(localEditing, oldRecord.scope);
        reactions.delete(localEditing);
      }

      applyCommitted(localAnchor, localScope);
      reactions.set(localAnchor, { reaction, scope: localScope, id: saved.id });
    } catch (e) {
      // Saving failed — don't paint a committed state we can't reload.
      console.error('reaction save failed:', e);
    } finally {
      clearTarget();
      closePopupDom();
      anchorWord = null;
      scope = null;
      editingAnchor = null;
      busy = false;
    }
  }

  async function resetReaction() {
    if (busy) return;
    if (!editingAnchor || !reactions.has(editingAnchor)) {
      // Nothing committed — just close without API call.
      clearTarget();
      closePopupDom();
      anchorWord = null; scope = null; editingAnchor = null;
      return;
    }
    busy = true;
    const localEditing = editingAnchor;
    const old = reactions.get(localEditing);
    const bm = getBookmarkState();
    try {
      if (bm && bm.bookmark_id && old.id) {
        await apiDeleteReaction({ bookmark_id: bm.bookmark_id, id: old.id });
      }
      removeCommitted(localEditing, old.scope);
      reactions.delete(localEditing);
    } catch (e) {
      console.error('reaction delete failed:', e);
    } finally {
      clearTarget();
      closePopupDom();
      anchorWord = null;
      scope = null;
      editingAnchor = null;
      busy = false;
    }
  }

  function closeSelection() {
    clearTarget();
    closePopupDom();
    anchorWord = null;
    scope = null;
    editingAnchor = null;
  }

  /* ---------- 10. Restore on load + on identity change ---------- */
  async function loadReactionsForCurrentBookmark() {
    const bm = getBookmarkState();
    if (!bm || !bm.bookmark_id) return;
    let list;
    try {
      list = await apiListReactions(bm.bookmark_id);
    } catch (_) { return; }

    // Wipe the local view first so a re-paint after a resume doesn't
    // double-paint or leave stale highlights from a previous bookmark.
    clearAllCommitted();

    list.forEach((r) => {
      if (!r.anchor_id || !r.scope) return;
      const anchor = document.querySelector(`.word[data-anchor-id="${CSS.escape(r.anchor_id)}"]`);
      if (!anchor) return;  // anchor not on this page (e.g. text changed); skip
      applyCommitted(anchor, r.scope);
      reactions.set(anchor, { reaction: r.reaction, scope: r.scope, id: r.id });
    });
  }

  // Fire on load (bookmark.js may set state synchronously from
  // localStorage; if so we'll have it already) and on every identity
  // change (resume → fresh fetch of that bookmark's reactions).
  window.addEventListener('bm:identity-changed', loadReactionsForCurrentBookmark);
  // Tiny delay to let bookmark.js's IIFE finish if scripts load close together.
  setTimeout(loadReactionsForCurrentBookmark, 0);

  /* ---------- 11. Master click handler ---------- */
  document.addEventListener('click', (e) => {
    if (popup && popup.contains(e.target)) return;

    const word = e.target.closest('.word');

    if (word && !word.closest('.story.feedback-enabled')) return;

    if (!word) {
      if (popup || anchorWord) closeSelection();
      return;
    }

    if (anchorWord && !editingAnchor) {
      const currentWords = getScopeWords(anchorWord, scope);
      if (currentWords.includes(word)) {
        // Cycle: word → paragraph → scene → word → ...
        if (scope === 'word') scope = 'paragraph';
        else if (scope === 'paragraph') scope = 'scene';
        else if (scope === 'scene') scope = 'word';
        applyTarget(anchorWord, scope);
        requestAnimationFrame(positionPopup);
        return;
      }
    }

    const committed = findCommittedFor(word);
    if (committed) {
      closeSelection();
      editingAnchor = committed.anchor;
      anchorWord = committed.anchor;
      scope = committed.data.scope;
      applyTarget(anchorWord, scope);
      openPopup({ currentReaction: committed.data.reaction, isEditing: true });
      return;
    }

    closeSelection();
    anchorWord = word;
    scope = 'word';
    editingAnchor = null;
    applyTarget(anchorWord, scope);
    openPopup({ currentReaction: null });
  });

  /* ---------- 12. Keep popup anchored on scroll / resize ---------- */
  window.addEventListener('scroll', () => { if (popup) positionPopup(); }, { passive: true });
  window.addEventListener('resize', () => { if (popup) positionPopup(); });

  /* ---------- 13. Escape key closes the popup ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popup) closeSelection();
  });
})();
