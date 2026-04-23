/* ===================================================================
   feedback.js — drop-in widget for the Ad Yaeli feedback layer.

   Any page that loads this script will auto-activate on every
   <article class="story feedback-enabled"> it finds.
   =================================================================== */

(function () {
  const stories = document.querySelectorAll('.story.feedback-enabled');
  if (stories.length === 0) return;

  /* ---------- 1. Wrap every word in a <span class="word"> ---------- */
  stories.forEach((story) => {
    const paragraphs = Array.from(story.querySelectorAll('p:not(.break)'));
    paragraphs.forEach((p) => {
      if (p.dataset.fbWrapped === '1') return;
      const original = p.textContent;
      p.textContent = '';
      const tokens = original.split(/(\s+)/);
      tokens.forEach((tok) => {
        if (tok === '') return;
        if (/^\s+$/.test(tok)) {
          p.appendChild(document.createTextNode(tok));
        } else {
          const span = document.createElement('span');
          span.className = 'word';
          span.textContent = tok;
          p.appendChild(span);
        }
      });
      p.dataset.fbWrapped = '1';
    });
  });

  /* ---------- 2. State ---------- */
  let popup = null;
  let anchorWord = null;
  let scope = null;
  let editingAnchor = null;
  const reactions = new Map();

  /* ---------- 3. Scope helpers ---------- */
  function getParagraphOf(wordEl) { return wordEl.closest('p'); }

  /**
   * 3rd-tap scope: the word's paragraph PLUS up to 3 preceding paragraphs,
   * bounded by the chapter break (<p class="break">). Never crosses a break.
   * So if the word is in the 2nd paragraph of the chapter, only the 1st
   * paragraph is added (stopping at the break at the chapter's top).
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
      if (kids[i].classList.contains('break')) break; // chapter boundary
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

    // Arrow is now 20px wide (2x) — offset by half that so it points at the anchor
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

  function commitReaction(reaction) {
    if (!anchorWord || !scope) return;

    if (editingAnchor && reactions.has(editingAnchor)) {
      const old = reactions.get(editingAnchor);
      removeCommitted(editingAnchor, old.scope);
      reactions.delete(editingAnchor);
    }

    applyCommitted(anchorWord, scope);
    reactions.set(anchorWord, { reaction, scope });

    clearTarget();
    closePopupDom();
    anchorWord = null;
    scope = null;
    editingAnchor = null;
  }

  function resetReaction() {
    if (editingAnchor && reactions.has(editingAnchor)) {
      const old = reactions.get(editingAnchor);
      removeCommitted(editingAnchor, old.scope);
      reactions.delete(editingAnchor);
    }
    clearTarget();
    closePopupDom();
    anchorWord = null;
    scope = null;
    editingAnchor = null;
  }

  function closeSelection() {
    clearTarget();
    closePopupDom();
    anchorWord = null;
    scope = null;
    editingAnchor = null;
  }

  /* ---------- 8. Master click handler ---------- */
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

  /* ---------- 9. Keep popup anchored on scroll / resize ---------- */
  window.addEventListener('scroll', () => { if (popup) positionPopup(); }, { passive: true });
  window.addEventListener('resize', () => { if (popup) positionPopup(); });

  /* ---------- 10. Escape key closes the popup ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popup) closeSelection();
  });
})();
