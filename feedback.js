/* ===================================================================
   feedback.js — drop-in widget for the Ad Yaeli feedback layer.

   Each tap on a word opens a popup with three save paths:
     אהבתי / לשפר        — commit a reaction
     +טקסט               — open a textarea, type, ✓ to commit a comment
     reset (↶)           — drop the whole feedback for this passage
     close (✕)           — dismiss without saving

   Reactions and comments are not exclusive — both flow into the SAME
   record on the server (one record per highlighted passage). Tapping
   a previously-committed passage reopens the popup pre-filled with
   whichever pieces already exist.

   Persistence:
     - /api/reaction is now an upsert keyed by (bookmark_id, anchor_id).
     - Identity comes from bookmark.js (window.__bmGetState /
       window.__bmEnsureBookmark). On "bm:identity-changed" we refetch
       this user's records so highlights survive across devices.
   =================================================================== */

(function () {
  const REACTION_API = '/api/reaction';

  const stories = document.querySelectorAll('.story.feedback-enabled');
  if (stories.length === 0) return;

  /* ---------- 1. Wrap every word + stamp anchor IDs ----------
     Anchor ID format: "p<paragraphIdx>w<wordIdx>" — stable as long as
     the source text doesn't shift around. Lets us re-paint highlights
     on reload via [data-anchor-id="..."]. */
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

  /* ---------- 2. State ----------
     reactions: Map<anchorEl, { reaction: 'love'|'improve'|null,
                                comment: string,
                                scope: 'word'|'paragraph'|'scene' }> */
  let popup = null;
  let anchorWord = null;
  let scope = null;
  let editingAnchor = null;
  const reactions = new Map();
  let busy = false;

  /* ---------- 3. Tiny utils ---------- */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  /* ---------- 4. Scope helpers ---------- */
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

  /* Capture the highlighted text exactly as it appears on the page. */
  function getScopeText(anchor, scopeName) {
    if (scopeName === 'word') return (anchor.textContent || '').trim();
    const para = getParagraphOf(anchor);
    if (scopeName === 'paragraph') return (para.textContent || '').trim();
    if (scopeName === 'scene') {
      return getSceneParagraphs(para).map((p) => (p.textContent || '').trim()).join('\n\n');
    }
    return '';
  }

  /* ---------- 5. Visuals ---------- */
  function applyTarget(anchor, scopeName) {
    clearTarget();
    getScopeWords(anchor, scopeName).forEach((w) => w.classList.add('target'));
  }
  function clearTarget() {
    document.querySelectorAll('.word.target').forEach((w) => w.classList.remove('target'));
  }

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
    const currentComment = options.currentComment || '';
    const isEditing = !!options.isEditing;
    const startWithTextOpen = isEditing && !!currentComment;

    /* Source order matters: this row sits inside an RTL container,
       so visual L→R becomes [close, reset, divider, improve, love, +טקסט].
       That matches the UI where +טקסט lives on the far right (the
       reader's reading-start side in Hebrew). */
    popup.innerHTML = `
      <div class="fb-row">
        <button class="fb-btn fb-btn-text ${startWithTextOpen || currentComment ? 'has-text' : ''}"
                data-action="text" aria-label="הוסף טקסט">
          +טקסט
        </button>
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
                ${(currentReaction || currentComment) ? '' : 'disabled'}>
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
      <div class="fb-text-row" ${startWithTextOpen ? '' : 'hidden'}>
        <textarea class="fb-text-input"
                  placeholder="כמה מילים על הקטע…"
                  dir="rtl"
                  rows="2"
                  maxlength="600">${escapeHtml(currentComment)}</textarea>
        <button class="fb-btn fb-btn-text-confirm" data-action="text-submit" aria-label="אישור">
          <svg viewBox="0 0 24 24">
            <polyline points="4 12 10 18 20 6"/>
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

    if (startWithTextOpen) hideHint();

    positionPopup();
    requestAnimationFrame(() => popup.classList.add('visible'));
    popup.addEventListener('click', onPopupClick);

    // Submit on Enter (Shift+Enter inserts newline)
    const textarea = popup.querySelector('.fb-text-input');
    if (textarea) {
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submitComment();
        }
      });
    }
  }

  function closePopupDom() {
    if (popup) {
      popup.remove();
      popup = null;
    }
  }

  function hideHint() {
    if (!popup) return;
    const hint = popup.querySelector('.fb-hint');
    if (hint) hint.style.display = 'none';
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
    else if (action === 'text') toggleTextRow();
    else if (action === 'text-submit') submitComment();
    else if (action === 'reset') resetReaction();
    else if (action === 'close') closeSelection();
  }

  function toggleTextRow() {
    if (!popup) return;
    const row = popup.querySelector('.fb-text-row');
    if (!row) return;
    const textarea = row.querySelector('.fb-text-input');
    if (row.hasAttribute('hidden')) {
      row.removeAttribute('hidden');
      hideHint();
      // Reposition since the popup just got taller
      requestAnimationFrame(positionPopup);
    }
    if (textarea) {
      textarea.focus();
      const len = textarea.value.length;
      textarea.selectionStart = textarea.selectionEnd = len;
    }
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

  async function apiUpsertReaction(payload) {
    const res = await fetch(REACTION_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'api_error');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function apiDeleteReaction({ bookmark_id, anchor_id }) {
    const url = `${REACTION_API}?bookmark_id=${encodeURIComponent(bookmark_id)}&anchor_id=${encodeURIComponent(anchor_id)}`;
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

  /* ---------- 9. Save flows ----------
     Two flows, governed by whether the text-row is open:

     PATH 1 — reaction-only (text-row closed):
       reaction click → save → popup closes, word highlighted.

     PATH 2 — combined feedback (text-row open):
       reaction click → save → popup STAYS OPEN so the reader can keep
       writing → ✓ commits the text → popup closes.

     The text-row is the contract: while it's open, ✓ is the only thing
     that closes the popup. ✕ (cancel) and clicking outside also close,
     but those are explicit "abandon" actions. */

  /* Updates the reaction-button selected state in-place when the popup
     is staying open (path 2). Avoids re-rendering the popup, which
     would lose textarea focus and any pending IME composition. */
  function updateReactionSelection(reaction) {
    if (!popup) return;
    const loveBtn = popup.querySelector('.fb-btn[data-action="love"]');
    const improveBtn = popup.querySelector('.fb-btn[data-action="improve"]');
    if (loveBtn) loveBtn.classList.toggle('selected', reaction === 'love');
    if (improveBtn) improveBtn.classList.toggle('selected', reaction === 'improve');
    // Now that something is committed, reset (↶) is meaningful.
    const resetBtn = popup.querySelector('.fb-btn-reset');
    if (resetBtn) resetBtn.disabled = false;
  }

  /* Reaction click — durably saves the reaction. If the user is mid-
     composition of a comment (text-row open), keeps the popup open so
     the ✓ button remains the sole exit for that flow. */
  async function commitReaction(reaction) {
    if (busy) return;
    if (!anchorWord || !scope) return;

    const localAnchor = anchorWord;
    const localScope = scope;
    const text = getScopeText(localAnchor, localScope);
    const anchor_id = localAnchor.dataset.anchorId || '';

    // Snapshot text-row state BEFORE the await — popup may get torn
    // down mid-flight (e.g. user clicks outside) and we want the
    // decision to keep-open vs. close to reflect the state at click time.
    const textRow = popup ? popup.querySelector('.fb-text-row') : null;
    const textRowOpen = !!(textRow && !textRow.hasAttribute('hidden'));

    busy = true;

    let bm;
    try { bm = await ensureBookmark(); }
    catch (e) { busy = false; return; }

    // We deliberately do NOT pull draft text from the textarea here.
    // Reactions and comments are independent saves that merge on the
    // server. Comment is committed only via ✓ — that's the contract
    // that makes "popup stays open until ✓" meaningful.
    const payload = {
      bookmark_id: bm.bookmark_id,
      anchor_id,
      scope: localScope,
      text,
      reaction
    };

    try {
      const saved = await apiUpsertReaction(payload);
      applyCommitted(localAnchor, localScope);
      reactions.set(localAnchor, {
        reaction: saved.reaction || null,
        comment: saved.comment || '',
        scope: localScope
      });

      // Path 2: keep the popup open so the reader can finish their
      // text. Update the buttons in-place, refocus the textarea.
      if (textRowOpen && popup) {
        editingAnchor = localAnchor;  // record exists now → reset works
        updateReactionSelection(saved.reaction);
        const textarea = popup.querySelector('.fb-text-input');
        if (textarea) {
          const len = textarea.value.length;
          textarea.focus();
          try { textarea.setSelectionRange(len, len); } catch (_) {}
        }
        busy = false;
        return;
      }
    } catch (e) {
      console.error('reaction save failed:', e);
      // Path 2 with an error: still keep popup open so the reader can
      // retry. They didn't lose their typed text.
      if (textRowOpen && popup) {
        busy = false;
        return;
      }
    }

    // Path 1 (or popup was torn down mid-flight): close as before.
    finishPopupSession();
  }

  /* ✓ submit — saves the comment alongside any selected reaction. */
  async function submitComment() {
    if (busy) return;
    if (!anchorWord || !scope) return;
    if (!popup) return;
    const textarea = popup.querySelector('.fb-text-input');
    if (!textarea) return;
    const newComment = (textarea.value || '').trim();
    if (!newComment) return; // empty submit = no-op

    busy = true;
    const localAnchor = anchorWord;
    const localScope = scope;
    const text = getScopeText(localAnchor, localScope);
    const anchor_id = localAnchor.dataset.anchorId || '';

    let bm;
    try { bm = await ensureBookmark(); }
    catch (e) { busy = false; return; }

    try {
      const saved = await apiUpsertReaction({
        bookmark_id: bm.bookmark_id,
        anchor_id,
        scope: localScope,
        text,
        comment: newComment
      });
      applyCommitted(localAnchor, localScope);
      reactions.set(localAnchor, {
        reaction: saved.reaction || null,
        comment: saved.comment || '',
        scope: localScope
      });
    } catch (e) {
      console.error('comment save failed:', e);
    } finally {
      finishPopupSession();
    }
  }

  /* Reset — drops the entire feedback record (both reaction + comment). */
  async function resetReaction() {
    if (busy) return;
    const localEditing = editingAnchor;
    if (!localEditing || !reactions.has(localEditing)) {
      // Nothing committed yet — just close.
      finishPopupSession();
      return;
    }
    busy = true;
    const old = reactions.get(localEditing);
    const bm = getBookmarkState();
    const anchor_id = localEditing.dataset.anchorId || '';
    try {
      if (bm && bm.bookmark_id && anchor_id) {
        await apiDeleteReaction({ bookmark_id: bm.bookmark_id, anchor_id });
      }
      removeCommitted(localEditing, old.scope);
      reactions.delete(localEditing);
    } catch (e) {
      console.error('reaction delete failed:', e);
    } finally {
      finishPopupSession();
    }
  }

  function closeSelection() { finishPopupSession(); }

  function finishPopupSession() {
    clearTarget();
    closePopupDom();
    anchorWord = null;
    scope = null;
    editingAnchor = null;
    busy = false;
  }

  /* ---------- 10. Restore on load + on identity change ----------
     This is what makes highlights survive a refresh. The reader's
     bookmark_id (from bookmark.js / localStorage) is the cross-session
     identity; every record on the server is keyed by it. We:
       1. fetch all of this reader's records
       2. wipe ONLY if the fetch succeeded (so a transient failure never
          makes the user's highlights vanish)
       3. re-apply .committed on every anchor word
       4. mirror the records into the local Map so re-tapping a word
          opens the popup pre-filled with the existing reaction/comment

     Trigger paths (any one of them lights up the highlights):
       - "bm:identity-changed" event from bookmark.js — fires on:
           • normal page load (state recovered from localStorage)
           • resume on a different device (typing your name)
           • brand-new bookmark created
           • auto-assigned bookmark from the gate flow
       - setTimeout fallback — covers the weird race where
         bookmark.js init hasn't dispatched yet when feedback.js loads.
       - one short retry — if the first attempt finds no identity
         (e.g. reader hasn't created a bookmark yet), we wait a tick
         and try again before giving up. */
  async function loadReactionsForCurrentBookmark() {
    const bm = getBookmarkState();
    if (!bm || !bm.bookmark_id) return false;

    let list;
    try {
      list = await apiListReactions(bm.bookmark_id);
    } catch (_) {
      // API failed — leave existing highlights alone. Better to keep
      // possibly-stale paint than to flash everything to bare text.
      return false;
    }
    if (!Array.isArray(list)) return false;

    // Fetch succeeded — safe to reset and repaint.
    clearAllCommitted();

    list.forEach((r) => {
      if (!r.anchor_id || !r.scope) return;
      const anchor = document.querySelector(
        `.word[data-anchor-id="${CSS.escape(r.anchor_id)}"]`
      );
      if (!anchor) return;
      applyCommitted(anchor, r.scope);
      reactions.set(anchor, {
        reaction: r.reaction || null,
        comment: r.comment || '',
        scope: r.scope
      });
    });
    return true;
  }

  // Belt-and-suspenders: load on any identity signal AND on script start.
  window.addEventListener('bm:identity-changed', loadReactionsForCurrentBookmark);
  (async function bootstrapHighlights() {
    // Wait one tick so bookmark.js can finish its init() and populate
    // window.__bmGetState() from localStorage.
    await new Promise((r) => setTimeout(r, 0));
    const ok = await loadReactionsForCurrentBookmark();
    if (ok) return;
    // No identity yet (or empty list). Try once more after a short
    // delay — e.g. bookmark.js may dispatch identity-changed shortly
    // after init for newly-created bookmarks. The event listener also
    // covers this, but the explicit retry is cheap insurance.
    setTimeout(loadReactionsForCurrentBookmark, 250);
  })();

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
      openPopup({
        currentReaction: committed.data.reaction,
        currentComment: committed.data.comment || '',
        isEditing: true
      });
      return;
    }

    closeSelection();
    anchorWord = word;
    scope = 'word';
    editingAnchor = null;
    applyTarget(anchorWord, scope);
    openPopup({ currentReaction: null, currentComment: '' });
  });

  /* ---------- 12. Keep popup anchored on scroll / resize ---------- */
  window.addEventListener('scroll', () => { if (popup) positionPopup(); }, { passive: true });
  window.addEventListener('resize', () => { if (popup) positionPopup(); });

  /* ---------- 13. Escape key closes the popup ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popup) {
      // If textarea is focused, let Esc just blur it first; second Esc closes.
      if (document.activeElement && document.activeElement.classList.contains('fb-text-input')) {
        document.activeElement.blur();
        return;
      }
      closeSelection();
    }
  });
})();
