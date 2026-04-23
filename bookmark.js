/* ============================================================
   bookmark.js — drop-in widget for the Ad Yaeli bookmark feature.
   Requires: bookmark.css and a Netlify Function at /api/bookmark.
   (April 2026 — placeholder icons, real artwork swaps in later)
   ============================================================ */

(function () {
  /* ===== 1. Config ===== */
  const API = '/api/bookmark';
  const STORAGE_KEY = 'ad_yaeli_bookmark';
  const ICONS_PER_PAGE = 4;
  const SLIDER_GAP_PX = 16;

  /* ===== 2. Icon catalog (placeholders — swap images later) ===== */
  const ICONS = [
    { id: 'i01', name_default: 'ינשוף',    color: '#8a6f4a' }, // default (owl)
    { id: 'i02', name_default: 'דוב',      color: '#c97a52' },
    { id: 'i03', name_default: 'אריה',     color: '#d99a33' },
    { id: 'i04', name_default: 'חתול',     color: '#b2815b' },
    { id: 'i05', name_default: 'כלב',      color: '#967150' },
    { id: 'i06', name_default: 'שועל',     color: '#cb6d3a' },
    { id: 'i07', name_default: 'ארנב',     color: '#c9a59b' },
    { id: 'i08', name_default: 'פיל',      color: '#8e9aa7' },
    { id: 'i09', name_default: 'נמר',      color: '#cc9033' },
    { id: 'i10', name_default: 'סוס',      color: '#7c5f3f' },
    { id: 'i11', name_default: 'זאב',      color: '#7a7576' },
    { id: 'i12', name_default: 'דולפין',   color: '#558fa4' },
    { id: 'i13', name_default: 'פינגווין', color: '#3a3f46' },
    { id: 'i14', name_default: 'ציפור',    color: '#6ca3c0' },
    { id: 'i15', name_default: 'דג',       color: '#4a7a8b' },
    { id: 'i16', name_default: 'כבשה',     color: '#cfc4b1' },
    { id: 'i17', name_default: 'פרה',      color: '#a8a8a8' },
    { id: 'i18', name_default: 'עכבר',     color: '#8f8f8f' },
    { id: 'i19', name_default: 'צפרדע',    color: '#547644' },
    { id: 'i20', name_default: 'לוויתן',   color: '#5a6f80' }
  ];
  const DEFAULT_ICON = ICONS[0];
  const iconById = (id) => ICONS.find((i) => i.id === id) || DEFAULT_ICON;
  const iconNumber = (id) => id.replace(/^i0*/, '').padStart(2, '0');

  /* ===== 3. Persistent state (device-local) =====
     Cross-device identity is the API + the human name (unique).
     `has_created` toggles the name label under the chip. */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) { return null; }
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  let state = loadState() || {
    bookmark_id: null,
    name: null,
    icon_id: DEFAULT_ICON.id,
    has_created: false
  };

  /* ===== 4. Small utils ===== */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }
  function renderIconGlyph(icon) {
    return `<div class="bm-number">${iconNumber(icon.id)}</div>`;
  }

  /* ===== 5. API ===== */
  async function apiCreate(name, icon_id) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, icon_id })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || 'api_error'); err.status = res.status; throw err; }
    return data;
  }
  async function apiLookup(name) {
    const res = await fetch(`${API}?name=${encodeURIComponent(name)}`);
    if (res.status === 404) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || 'api_error'); err.status = res.status; throw err; }
    return data;
  }
  async function apiUpdate(id, updates) {
    const res = await fetch(API, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, ...updates })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || 'api_error'); err.status = res.status; throw err; }
    return data;
  }

  /* ===== 6. Chip (top-left of the landing) ===== */
  let chipEl = null;

  function renderChip() {
    if (!chipEl) return;
    const icon = iconById(state.icon_id);
    chipEl.innerHTML = `
      <div class="bm-chip-icon" style="--bm-color: ${icon.color}">
        ${renderIconGlyph(icon)}
      </div>
      <div class="bm-chip-label">${state.has_created && state.name ? escapeHtml(state.name) : ''}</div>
    `;
  }

  function installChip() {
    chipEl = document.createElement('div');
    chipEl.className = 'bm-chip';
    chipEl.setAttribute('role', 'button');
    chipEl.setAttribute('tabindex', '0');
    chipEl.setAttribute('aria-label', 'סימנייה');
    chipEl.addEventListener('click', onChipClick);
    chipEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChipClick(); }
    });
    document.body.appendChild(chipEl);
    renderChip();
  }
  function onChipClick() {
    if (state.has_created) openCreateModal({ editing: true });
    else openResumePopup();
  }

  /* ===== 7. Modal plumbing ===== */
  let backdropEl = null;
  let modalEl = null;

  function showModal(el) {
    closeModal();
    backdropEl = document.createElement('div');
    backdropEl.className = 'bm-backdrop';
    backdropEl.addEventListener('click', closeModal);
    document.body.appendChild(backdropEl);
    modalEl = el;
    document.body.appendChild(modalEl);
    requestAnimationFrame(() => {
      backdropEl.classList.add('visible');
      modalEl.classList.add('visible');
    });
    document.addEventListener('keydown', onEscape);
  }
  function closeModal() {
    document.removeEventListener('keydown', onEscape);
    const bp = backdropEl, md = modalEl;
    backdropEl = null; modalEl = null;
    if (bp) { bp.classList.remove('visible'); setTimeout(() => bp.remove(), 200); }
    if (md) { md.classList.remove('visible'); setTimeout(() => md.remove(), 200); }
  }
  function onEscape(e) { if (e.key === 'Escape') closeModal(); }

  /* ===== 8. Resume popup (ref2) ===== */
  function openResumePopup() {
    const el = document.createElement('div');
    el.className = 'bm-modal bm-popup-resume';
    el.innerHTML = `
      <div class="bm-resume-row">
        <div class="bm-resume-title">יש לי כבר סימנייה</div>
        <input class="bm-resume-input" type="text" placeholder="שם הסימנייה שלי" autocomplete="off" />
        <button class="bm-btn-check" aria-label="אישור" hidden>
          <svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>
        </button>
        <button class="bm-btn-close" aria-label="סגור">
          <svg viewBox="0 0 24 24"><path d="M6 6L18 18M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="bm-resume-error" role="alert"></div>
      <div class="bm-resume-create-row">
        <button class="bm-btn-outline bm-btn-new">+ צור סימנייה חדשה</button>
      </div>
    `;
    // Clicks inside the modal shouldn't bubble to the backdrop or document listeners
    el.addEventListener('click', (e) => e.stopPropagation());

    const closeBtn = el.querySelector('.bm-btn-close');
    const input = el.querySelector('.bm-resume-input');
    const err = el.querySelector('.bm-resume-error');
    const createBtn = el.querySelector('.bm-btn-new');

    const checkBtn = el.querySelector('.bm-btn-check');

    closeBtn.addEventListener('click', closeModal);
    createBtn.addEventListener('click', () => openCreateModal({ editing: false }));

    // --- Live lookup state ---
    let matchedBookmark = null;
    let lookupToken = 0;          // cancels stale responses
    let debounceTimer = null;

    function resetMatch() {
      matchedBookmark = null;
      input.classList.remove('error');
      err.textContent = '';
      checkBtn.hidden = true;
    }

    function showNoMatch() {
      matchedBookmark = null;
      input.classList.add('error');
      err.textContent = 'לא נמצאה סימנייה עם השם';
      checkBtn.hidden = true;
    }

    function showMatch(bm) {
      matchedBookmark = bm;
      input.classList.remove('error');
      err.textContent = '';
      checkBtn.hidden = false;
    }

    async function runLookup(raw) {
      const name = (raw || '').trim();
      const myToken = ++lookupToken;
      if (!name) { resetMatch(); return; }
      try {
        const bm = await apiLookup(name);
        if (myToken !== lookupToken) return;  // stale — newer keystroke already fired
        if (bm) showMatch(bm);
        else showNoMatch();
      } catch (e) {
        if (myToken !== lookupToken) return;
        input.classList.add('error');
        err.textContent = 'משהו השתבש, נסו שוב';
        checkBtn.hidden = true;
      }
    }

    input.addEventListener('input', () => {
      // While typing: clear prior match UI, then debounce the lookup
      input.classList.remove('error');
      err.textContent = '';
      checkBtn.hidden = true;
      matchedBookmark = null;
      clearTimeout(debounceTimer);
      const val = input.value;
      if (!val.trim()) return;   // don't call API on empty
      debounceTimer = setTimeout(() => runLookup(val), 300);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && matchedBookmark) {
        e.preventDefault();
        confirmMatch(matchedBookmark);
      }
    });

    checkBtn.addEventListener('click', () => {
      if (matchedBookmark) confirmMatch(matchedBookmark);
    });

    function confirmMatch(bm) {
      state = {
        bookmark_id: bm.id,
        name: bm.name,
        icon_id: bm.icon_id,
        has_created: true
      };
      saveState();
      renderChip();
      closeModal();
      toast(`ברוך שובך, ${bm.name}`);
    }

    showModal(el);
    setTimeout(() => input.focus(), 120);
  }

  /* ===== 9. Create / edit modal (ref3) ===== */
  function openCreateModal({ editing }) {
    // Snapshot "initial" values so we can tell if the user actually changed anything.
    const initialIconId = editing ? state.icon_id : DEFAULT_ICON.id;
    const initialName = editing && state.name ? state.name : '';

    // Working values that the user edits in the modal
    let pickedIconId = initialIconId;
    let nameDirty = false;   // true once the user types in the name field
    let page = 0;
    const pages = Math.max(1, Math.ceil(ICONS.length / ICONS_PER_PAGE));

    const el = document.createElement('div');
    el.className = 'bm-modal bm-popup-create';
    el.innerHTML = `
      <div class="bm-create-grid">
        <button class="bm-btn-close" aria-label="סגור">
          <svg viewBox="0 0 24 24"><path d="M6 6L18 18M18 6L6 18"/></svg>
        </button>

        <div class="bm-create-preview">
          <div class="bm-create-preview-label">סימנייה</div>
          <div class="bm-preview-icon" data-role="preview"></div>
          <input class="bm-name-input" type="text" placeholder="שם הסימנייה" autocomplete="off" />
          <div class="bm-name-error" role="alert"></div>
        </div>

        <div class="bm-create-instructions">
          <h3>${editing ? 'עריכת סימנייה' : 'יצירת סימנייה'}</h3>
          <ol>
            <li>בחר/י אייקון</li>
            <li>בחר/י שם</li>
            <li>הכנס/י את שם הסימנייה בכל ביקור להמשך קריאה מהמקום בו עצרת</li>
          </ol>
        </div>

        <div class="bm-slider-row">
          <button class="bm-slider-arrow bm-prev" aria-label="הקודם">
            <svg viewBox="0 0 24 24"><polyline points="15 6 9 12 15 18"/></svg>
          </button>
          <div class="bm-slider-viewport">
            <div class="bm-slider-track" data-role="track"></div>
          </div>
          <button class="bm-slider-arrow bm-next" aria-label="הבא">
            <svg viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18"/></svg>
          </button>
        </div>

        <div class="bm-slider-dots" data-role="dots"></div>

        <div class="bm-confirm-row">
          <button class="bm-btn-confirm" aria-label="אישור" disabled>
            <svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg>
          </button>
        </div>
      </div>
    `;
    el.addEventListener('click', (e) => e.stopPropagation());

    const closeBtn = el.querySelector('.bm-btn-close');
    const previewEl = el.querySelector('[data-role="preview"]');
    const trackEl = el.querySelector('[data-role="track"]');
    const dotsEl = el.querySelector('[data-role="dots"]');
    const nameInput = el.querySelector('.bm-name-input');
    const nameErr = el.querySelector('.bm-name-error');
    const confirmBtn = el.querySelector('.bm-btn-confirm');
    const prevBtn = el.querySelector('.bm-prev');
    const nextBtn = el.querySelector('.bm-next');

    // ---- Render helpers ----
    function refreshPreview() {
      const icon = iconById(pickedIconId);
      previewEl.style.setProperty('--bm-color', icon.color);
      previewEl.innerHTML = renderIconGlyph(icon);
    }
    function renderTrack() {
      trackEl.innerHTML = ICONS.map((icon) => `
        <div class="bm-slider-item ${icon.id === pickedIconId ? 'selected' : ''}"
             data-id="${icon.id}" style="--bm-color: ${icon.color}">
          ${renderIconGlyph(icon)}
        </div>
      `).join('');
      trackEl.querySelectorAll('.bm-slider-item').forEach((it) => {
        it.addEventListener('click', () => {
          pickedIconId = it.dataset.id;
          trackEl.querySelectorAll('.bm-slider-item').forEach((o) =>
            o.classList.toggle('selected', o.dataset.id === pickedIconId));
          refreshPreview();
          // Auto-fill name with the icon's default UNTIL the user has typed something themselves
          if (!nameDirty) {
            nameInput.value = iconById(pickedIconId).name_default;
          }
          refreshConfirm();
        });
      });
    }
    function pageOffsetPx(n) {
      // Works in both LTR and RTL because we translate by a positive number
      // and the track is always laid out in DOM order; in RTL flex the first
      // item sits at the right, so a positive translateX reveals later items
      // from the left.
      const firstItem = trackEl.querySelector('.bm-slider-item');
      if (!firstItem) return 0;
      const itemW = firstItem.getBoundingClientRect().width;
      const pageW = (itemW + SLIDER_GAP_PX) * ICONS_PER_PAGE;
      return n * pageW;
    }
    function refreshSlider() {
      trackEl.style.transform = `translateX(${pageOffsetPx(page)}px)`;
      prevBtn.disabled = page === 0;
      nextBtn.disabled = page >= pages - 1;
      dotsEl.innerHTML = Array.from({ length: pages }, (_, i) =>
        `<div class="bm-slider-dot${i === page ? ' active' : ''}"></div>`
      ).join('');
    }
    function refreshConfirm() {
      // Rule: V enabled only when the user picked a (different) icon OR edited the name.
      const iconChanged = pickedIconId !== initialIconId;
      const currentName = (nameInput.value || '').trim();
      const defaultName = iconById(pickedIconId).name_default;
      // In editing mode: "edited" means differs from the name already on the bookmark.
      // In create mode: "edited" means the user typed something different from the
      // auto-filled default (so just picking an icon + keeping its default name is
      // a valid action — it counts as icon-picked).
      const nameEdited = editing
        ? (currentName !== (initialName || '').trim() && currentName.length > 0)
        : (nameDirty && currentName.length > 0 && currentName !== defaultName);
      const hasPickedIcon = !editing && pickedIconId !== DEFAULT_ICON.id;
      const anyAction = iconChanged || nameEdited || hasPickedIcon;
      confirmBtn.disabled = !anyAction;
    }

    // ---- Wire events ----
    closeBtn.addEventListener('click', closeModal);
    prevBtn.addEventListener('click', () => { if (page > 0) { page--; refreshSlider(); } });
    nextBtn.addEventListener('click', () => { if (page < pages - 1) { page++; refreshSlider(); } });

    nameInput.value = initialName;
    nameInput.addEventListener('input', () => {
      nameDirty = true;
      nameInput.classList.remove('error');
      nameErr.textContent = '';
      refreshConfirm();
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !confirmBtn.disabled) commit();
    });

    confirmBtn.addEventListener('click', commit);

    async function commit() {
      if (confirmBtn.disabled) return;
      const typed = (nameInput.value || '').trim();
      const finalName = typed || iconById(pickedIconId).name_default;

      try {
        confirmBtn.disabled = true;

        let bm;
        if (editing && state.bookmark_id) {
          bm = await apiUpdate(state.bookmark_id, { name: finalName, icon_id: pickedIconId });
        } else {
          bm = await apiCreate(finalName, pickedIconId);
        }

        state = {
          bookmark_id: bm.id,
          name: bm.name,
          icon_id: bm.icon_id,
          has_created: true
        };
        saveState();
        renderChip();
        closeModal();
        toast(editing ? 'הסימנייה עודכנה' : `נוצרה סימנייה: ${state.name}`);
      } catch (e) {
        if (String(e.message) === 'name_taken') {
          nameInput.classList.add('error');
          nameErr.textContent = 'השם הזה כבר תפוס, נסו אחר';
        } else {
          nameInput.classList.add('error');
          nameErr.textContent = 'משהו השתבש, נסו שוב';
        }
        refreshConfirm();
      }
    }

    // ---- Kick off ----
    refreshPreview();
    renderTrack();
    showModal(el);
    // Slider offsets depend on laid-out widths, so compute after first paint
    requestAnimationFrame(refreshSlider);

    const onResize = () => {
      if (!document.body.contains(el)) {
        window.removeEventListener('resize', onResize);
        return;
      }
      refreshSlider();
    };
    window.addEventListener('resize', onResize);
  }

  /* ===== 10. Toast ===== */
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'bm-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('visible'));
    setTimeout(() => {
      t.classList.remove('visible');
      setTimeout(() => t.remove(), 220);
    }, 2600);
  }

  /* ===== 11. Init ===== */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installChip);
  } else {
    installChip();
  }
})();
console.log("bookmark.js loaded");

fetch('/api/bookmark?url=' + encodeURIComponent(window.location.href))
  .then(res => res.json())
  .then(data => {
    console.log("API response:", data);
  })
  .catch(err => console.error("API error:", err));