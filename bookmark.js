/* ============================================================
   bookmark.js — drop-in widget for the Ad Yaeli bookmark feature.
   Requires: bookmark.css and a Netlify Function at /api/bookmark.
   (April 2026 — placeholder icons, real artwork swaps in later)
   ============================================================ */

(function () {
  /* ===== 1. Config ===== */
  const API = '/api/bookmark';
  const PROGRESS_API = '/api/bookmark/progress';
  const STORAGE_KEY = 'ad_yaeli_bookmark';
  const ICONS_PER_PAGE = 4;
  const SLIDER_GAP_PX = 16;

  /* ===== 2. Icon catalog (placeholders — swap images later) ===== */
  const ICONS = [
    { id: 'i01', name_default: 'ינשוף',       color: '#1a1a1a', image: 'icons/i01.png' }, // owl (default)
    { id: 'i02', name_default: 'דוב',         color: '#1a1a1a', image: 'icons/i02.png' }, // bear
    { id: 'i03', name_default: 'קואלה',       color: '#1a1a1a', image: 'icons/i03.png' }, // koala
    { id: 'i04', name_default: 'עופר',        color: '#1a1a1a', image: 'icons/i04.png' }, // fawn
    { id: 'i05', name_default: 'אייל',        color: '#1a1a1a', image: 'icons/i05.png' }, // stag
    { id: 'i06', name_default: 'גורילה',      color: '#1a1a1a', image: 'icons/i06.png' }, // gorilla
    { id: 'i07', name_default: 'אריה',        color: '#1a1a1a', image: 'icons/i07.png' }, // lion
    { id: 'i08', name_default: 'ארנב',        color: '#1a1a1a', image: 'icons/i08.png' }, // rabbit
    { id: 'i09', name_default: 'דוב חום',     color: '#1a1a1a', image: 'icons/i09.png' }, // brown bear
    { id: 'i10', name_default: 'עצלן',        color: '#1a1a1a', image: 'icons/i10.png' }, // sloth
    { id: 'i11', name_default: 'נמר',         color: '#1a1a1a', image: 'icons/i11.png' }, // tiger
    { id: 'i12', name_default: 'תנשמת',       color: '#1a1a1a', image: 'icons/i12.png' }, // barn owl
    { id: 'i13', name_default: 'שועל',        color: '#1a1a1a', image: 'icons/i13.png' }, // fox (blue)
    { id: 'i14', name_default: 'שועל',        color: '#1a1a1a', image: 'icons/i14.png' }, // fox
    { id: 'i15', name_default: 'גירית',       color: '#1a1a1a', image: 'icons/i15.png' }, // badger
    { id: 'i16', name_default: 'כף יד',       color: '#1a1a1a', image: 'icons/i16.png' }, // paw print
    { id: 'i17', name_default: 'כלב',         color: '#1a1a1a', image: 'icons/i17.png' }, // dog
    { id: 'i18', name_default: 'חזיר בר',     color: '#1a1a1a', image: 'icons/i18.png' }, // boar
    { id: 'i19', name_default: 'פנדה',        color: '#1a1a1a', image: 'icons/i19.png' }, // panda
    { id: 'i20', name_default: 'בונה',        color: '#1a1a1a', image: 'icons/i20.png' }, // beaver
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
    has_created: false,
    gate_reached: 0,
    theme: 'animals'
  };
  // Back-compat: older saved states won't have gate_reached / theme
  if (typeof state.gate_reached !== 'number') state.gate_reached = 0;
  if (!state.theme) state.theme = 'animals';

  /* ===== 4. Small utils ===== */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }
  function renderIconGlyph(icon) {
    if (icon.image) {
      return `<img class="bm-icon-img" src="${icon.image}" alt="" draggable="false" />`;
    }
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
  async function apiSuggestedDefaults(themeId) {
    // Returns { names: [...], by_icon: { i01: 'name', ... }, theme, label }
    // for the requested theme. On any failure, returns null so caller falls
    // back to ICONS' hardcoded defaults.
    //   names    — flat ordered list of UNCLAIMED names (for autoAssign)
    //   by_icon  — full theme map keyed by icon_id (paint icon labels)
    try {
      const t = themeId ? `&theme=${encodeURIComponent(themeId)}` : '';
      const res = await fetch(`${API}?defaults=1${t}`);
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      if (!data || (!Array.isArray(data.names) && !data.by_icon)) return null;
      return {
        names: Array.isArray(data.names) ? data.names : [],
        by_icon: data.by_icon && typeof data.by_icon === 'object' ? data.by_icon : {},
        theme: data.theme || themeId || 'animals',
        label: data.label || ''
      };
    } catch (e) {
      return null;
    }
  }

  async function apiThemes() {
    // Returns [{ id, label, default }] for the picker UI.
    try {
      const res = await fetch(`${API}?themes=1`);
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      return Array.isArray(data.themes) ? data.themes : null;
    } catch (e) {
      return null;
    }
  }

  async function apiProgress(bookmark_id, gate_reached) {
    const res = await fetch(PROGRESS_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookmark_id, gate_reached })
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
      <div class="bm-chip-label">${state.has_created && state.name ? escapeHtml(state.name) : 'סימנייה'}</div>
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
        has_created: true,
        gate_reached: typeof bm.gate_reached === 'number' ? bm.gate_reached : 0,
        theme: state.theme || 'animals'
      };
      saveState();
      renderChip();
      applyGateState();
      closeModal();
      toast(`ברוך שובך, ${bm.name}`);
      // Tell feedback.js (and anyone else listening) to reload this
      // bookmark's data — e.g. their previously-saved reactions.
      try {
        window.dispatchEvent(new CustomEvent('bm:identity-changed', { detail: { ...state } }));
      } catch (_) {}
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

    // Theme = the named-set the icon labels come from (animals / disney / sports).
    // Defaults to whatever's in state.theme; user can flip it via the picker chips.
    let pickedTheme = state.theme || 'animals';

    const el = document.createElement('div');
    el.className = 'bm-modal bm-popup-create';
    el.innerHTML = `
      <div class="bm-create-grid">
        <button class="bm-btn-close" aria-label="סגור">
          <svg viewBox="0 0 24 24"><path d="M6 6L18 18M18 6L6 18"/></svg>
        </button>

        <div class="bm-create-header">
          <h3>${editing ? 'עריכת סימנייה' : 'יצירת סימנייה'}</h3>
          <p class="bm-create-subtitle">הכנס/י את שם הסימנייה בביקור הבא להמשך קריאה מהמקום בו עצרת.</p>
        </div>

        <div class="bm-step bm-step-icon">
          <div class="bm-step-label"><span class="bm-step-num">1.</span> בחר/י אייקון</div>
          <div class="bm-slider-row">
            <button class="bm-slider-arrow bm-prev" aria-label="הקודם">
              <svg viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18"/></svg>
            </button>
            <div class="bm-slider-viewport">
              <div class="bm-slider-track" data-role="track"></div>
            </div>
            <button class="bm-slider-arrow bm-next" aria-label="הבא">
              <svg viewBox="0 0 24 24"><polyline points="15 6 9 12 15 18"/></svg>
            </button>
          </div>
        </div>

        <div class="bm-step bm-step-name">
          <div class="bm-step-label"><span class="bm-step-num">2.</span> בחר/י שם</div>
          <div class="bm-step-input-wrap">
            <input class="bm-name-input" type="text" placeholder="שם הסימנייה" autocomplete="off" />
            <div class="bm-name-error" role="alert"></div>
          </div>
        </div>

        <div class="bm-confirm-row">
          <button class="bm-btn-confirm" aria-label="אישור" disabled>
            <svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg>
          </button>
        </div>
      </div>
    `;
    el.addEventListener('click', (e) => e.stopPropagation());

    const closeBtn = el.querySelector('.bm-btn-close');
    const trackEl = el.querySelector('[data-role="track"]');
    const nameInput = el.querySelector('.bm-name-input');
    const nameErr = el.querySelector('.bm-name-error');
    const confirmBtn = el.querySelector('.bm-btn-confirm');
    const prevBtn = el.querySelector('.bm-prev');
    const nextBtn = el.querySelector('.bm-next');

    // Theme picker UI removed in the new design — names are still loaded from the
    // active theme (defaults to 'animals') so icon name_default values stay populated.
    function loadDefaultsForTheme(themeId) {
      apiSuggestedDefaults(themeId).then((data) => {
        if (!data) return;
        // Patch icon name_default from the by_icon map (1:1 — every icon has a name).
        ICONS.forEach((icon) => {
          const n = data.by_icon && data.by_icon[icon.id];
          if (n) icon.name_default = n;
        });
        // If the user hasn't edited the name field yet, repaint it to the fresh default.
        if (!editing && !nameDirty && pickedIconId !== DEFAULT_ICON.id) {
          nameInput.value = iconById(pickedIconId).name_default;
        } else if (!editing && !nameDirty) {
          // First-load case: no icon picked yet, but show the active theme's first
          // suggestion in the placeholder so the field doesn't look empty/orphaned.
          if (data.names && data.names.length) {
            nameInput.placeholder = data.names[0];
          }
        }
        // Repaint the slider tiles in case any visible label was theme-driven.
        // (Slider currently shows just the artwork — no label paint needed today,
        // but keeping the call cheap so adding a label later is one-line.)
      });
    }

    // Kick off initial load for the persisted (or default) theme.
    loadDefaultsForTheme(pickedTheme);

    // ---- Render helpers ----
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
      prevBtn.disabled = false;
      nextBtn.disabled = false;
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
    prevBtn.addEventListener('click', () => { page = (page - 1 + pages) % pages; refreshSlider(); });
    nextBtn.addEventListener('click', () => { page = (page + 1) % pages; refreshSlider(); });

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
          has_created: true,
          gate_reached: typeof bm.gate_reached === 'number' ? bm.gate_reached : (state.gate_reached || 0),
          theme: pickedTheme || state.theme || 'animals'
        };
        saveState();
        renderChip();
        closeModal();
        toast(editing ? 'הסימנייה עודכנה' : `נוצרה סימנייה: ${state.name}`);
        if (typeof window.__bmOnCreateCommit === 'function') {
          try { window.__bmOnCreateCommit(state); } catch (_) {}
        }
        try {
          window.dispatchEvent(new CustomEvent('bm:identity-changed', { detail: { ...state } }));
        } catch (_) {}
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

  /* ===== 9.5. Reading Gates =====
     Markup: <div class="reading-gate" data-gate="N"></div>
     Behavior:
       - Find first uncleared gate (data-gate > state.gate_reached). Mark it .active.
       - .active gate renders the "להמשיך לקרוא" button.
       - CSS blurs all siblings AFTER the active gate.
       - Click the button → POST progress (or open create modal if no bookmark yet).
  */

  function getGates() {
    return Array.from(document.querySelectorAll('.reading-gate'))
      .map((el) => ({ el, num: parseInt(el.dataset.gate, 10) }))
      .filter((g) => Number.isFinite(g.num) && g.num >= 1)
      .sort((a, b) => a.num - b.num);
  }

  function clearGateUI(el) {
    // Remove our injected button so the gate is just an empty div when cleared.
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function renderGateButton(el, gateNum) {
    clearGateUI(el);
    const btn = document.createElement('button');
    btn.className = 'reading-gate-button';
    btn.type = 'button';
    // data-cta lets a specific gate override the default label (e.g. "סיימתי!" on the completion gate).
    const customCta = el.getAttribute('data-cta');
    btn.textContent = customCta && customCta.trim() ? customCta.trim() : 'להמשיך לקרוא';
    btn.addEventListener('click', () => onGateClick(gateNum, btn, el));
    el.appendChild(btn);
  }

  function applyGateState() {
    const gates = getGates();
    const reached = state.gate_reached || 0;

    // First gate where number > reached is the new active gate.
    let activeGate = gates.find((g) => g.num > reached);

    // Edge case: the end-of-available "you're caught up" gate is special —
    // it should stay visible at the bottom of the page even after the user
    // has clicked it (so a returning caught-up reader still sees a closure
    // marker instead of the page just ending). If gate_reached has caught
    // up past every gate but the highest gate is end-of-available, surface
    // it as active. Click handler is still idempotent (recordGateProgress
    // uses Math.max), so no state damage.
    if (!activeGate) {
      const endOfAvailable = gates.find(
        (g) => g.el.getAttribute('data-end-of-available') === '1'
      );
      if (endOfAvailable) activeGate = endOfAvailable;
    }

    gates.forEach((g) => {
      if (!activeGate || g === activeGate) return;
      // Cleared gates and gates beyond active — both visually invisible.
      g.el.classList.remove('active');
      g.el.classList.add('cleared');
      clearGateUI(g.el);
    });

    if (activeGate) {
      activeGate.el.classList.remove('cleared');
      activeGate.el.classList.add('active');
      renderGateButton(activeGate.el, activeGate.num);
    }
  }

  async function syncGateStateFromServer() {
    if (!state.bookmark_id) return;
    try {
      const res = await fetch(`${API}?id=${encodeURIComponent(state.bookmark_id)}`);
      if (!res.ok) return;
      const bm = await res.json().catch(() => ({}));
      const serverReached = typeof bm.gate_reached === 'number' ? bm.gate_reached : 0;
      if (serverReached > (state.gate_reached || 0)) {
        state.gate_reached = serverReached;
        saveState();
        applyGateState();
      }
    } catch (_) { /* offline — local state is fine */ }
  }

  // First-time-reader flow: open the create modal. If they commit a name → great.
  // If they dismiss the modal (X / backdrop / Escape), we silently auto-assign
  // a random available default name so they're never blocked from continuing.
  function openCreateModalForGate(onResolved) {
    let committed = false;
    const targetEl = (() => {
      // Stash the modal element AFTER it gets created so we can observe its removal.
      // showModal appends to document.body; we'll grab it after rAF.
      return null;
    })();

    window.__bmOnCreateCommit = function (newState) {
      committed = true;
      window.__bmOnCreateCommit = null;
      onResolved({ committed: true, state: newState });
    };

    openCreateModal({ editing: false });

    // Watch for the create modal being removed from DOM. If it disappears
    // without commit() running, treat it as a dismiss → auto-assign.
    const observer = new MutationObserver(() => {
      const stillThere = document.querySelector('.bm-popup-create');
      if (!stillThere) {
        observer.disconnect();
        if (!committed) {
          window.__bmOnCreateCommit = null;
          onResolved({ committed: false });
        }
      }
    });
    observer.observe(document.body, { childList: true });
  }

  async function autoAssignBookmark() {
    // Pull a list of currently-available default names from the active theme.
    const themeId = state.theme || 'animals';
    const data = await apiSuggestedDefaults(themeId);
    let names = (data && data.names) || [];
    if (!names.length) {
      // Worst-case fallback: synthesize a unique-ish name.
      names = [`קורא_${Math.random().toString(36).slice(2, 6)}`];
    }
    // Pick a random icon (avoid the default owl so each new reader feels distinct).
    const pickableIcons = ICONS.filter((i) => i.id !== DEFAULT_ICON.id);
    const icon = pickableIcons[Math.floor(Math.random() * pickableIcons.length)] || DEFAULT_ICON;

    // Try names in order; on collision (race condition), advance to the next.
    for (const candidate of names) {
      try {
        const bm = await apiCreate(candidate, icon.id);
        state = {
          bookmark_id: bm.id,
          name: bm.name,
          icon_id: bm.icon_id,
          has_created: true,
          gate_reached: 0,
          theme: themeId
        };
        saveState();
        renderChip();
        try {
          window.dispatchEvent(new CustomEvent('bm:identity-changed', { detail: { ...state } }));
        } catch (_) {}
        return bm;
      } catch (e) {
        if (String(e.message) === 'name_taken') continue;
        throw e;
      }
    }
    throw new Error('no_available_names');
  }

  async function recordGateProgress(gateNum) {
    if (!state.bookmark_id) return;
    try {
      const bm = await apiProgress(state.bookmark_id, gateNum);
      const serverReached = typeof bm.gate_reached === 'number' ? bm.gate_reached : gateNum;
      state.gate_reached = Math.max(state.gate_reached || 0, serverReached, gateNum);
      saveState();
      applyGateState();
    } catch (e) {
      toast('משהו השתבש, נסו שוב');
      // Re-enable the button so the user can retry.
      applyGateState();
    }
  }

  // Small modal that tells caught-up readers "more chapters coming soon".
  // Used while the book is still being uploaded; flipped to the real
  // end-of-book celebration once all chapters are live.
  function openComingSoonModal() {
    const el = document.createElement('div');
    el.className = 'bm-modal bm-popup-coming-soon';
    el.innerHTML = `
      <button class="bm-btn-close" aria-label="סגור">
        <svg viewBox="0 0 24 24"><path d="M6 6L18 18M18 6L6 18"/></svg>
      </button>
      <div class="bm-coming-soon-body">
        <div class="bm-coming-soon-title">פרקים נוספים יעלו בקרוב</div>
      </div>
    `;
    el.addEventListener('click', (e) => e.stopPropagation());
    el.querySelector('.bm-btn-close').addEventListener('click', closeModal);
    showModal(el);
  }

  // Fire the end-of-book hook AFTER progress is recorded.
  // The future modal lives outside this file and registers via window.__bmOnCompleteBook.
  function maybeFireCompletion(gateEl) {
    if (!gateEl) return;
    if (gateEl.getAttribute('data-completion') !== '1') return;
    if (typeof window.__bmOnCompleteBook === 'function') {
      try { window.__bmOnCompleteBook({ ...state }); } catch (_) {}
    }
  }

  // "Caught up — more coming" handler for the temporary last gate.
  function maybeFireEndOfAvailable(gateEl) {
    if (!gateEl) return;
    if (gateEl.getAttribute('data-end-of-available') !== '1') return;
    openComingSoonModal();
  }

  /* ===== 9.6. Public helpers for other widgets =====
     Other scripts (feedback.js) need two things:
       - ensureBookmark(): "I'm about to record something, make sure
         the reader has a bookmark first." Mirrors the gate flow:
         show create modal → on dismiss, auto-assign → resolve.
       - "bm:identity-changed" event: fired whenever bookmark identity
         changes (created, matched on resume, auto-assigned). Lets
         feedback.js re-fetch this user's reactions on resume so a
         reader who types in their old bookmark name gets all their
         highlights restored. */
  function dispatchIdentityChanged() {
    try {
      window.dispatchEvent(new CustomEvent('bm:identity-changed', { detail: { ...state } }));
    } catch (_) {}
  }

  function ensureBookmark() {
    return new Promise((resolve, reject) => {
      if (state.has_created && state.bookmark_id) {
        resolve({ ...state });
        return;
      }
      openCreateModalForGate(async ({ committed }) => {
        if (!committed) {
          try {
            const bm = await autoAssignBookmark();
            toast(`נוצרה לך סימנייה: ${bm.name}`);
          } catch (e) {
            toast('משהו השתבש, נסו שוב');
            reject(e);
            return;
          }
        }
        // Whether committed or auto-assigned, identity has changed.
        dispatchIdentityChanged();
        resolve({ ...state });
      });
    });
  }

  // Expose for feedback.js / future widgets.
  window.__bmEnsureBookmark = ensureBookmark;
  window.__bmGetState = () => ({ ...state });

  async function onGateClick(gateNum, btnEl, gateEl) {
    if (btnEl) btnEl.disabled = true;

    if (state.has_created && state.bookmark_id) {
      await recordGateProgress(gateNum);
      maybeFireCompletion(gateEl);
      maybeFireEndOfAvailable(gateEl);
      return;
    }

    // First-time reader (no bookmark yet)
    openCreateModalForGate(async ({ committed }) => {
      if (!committed) {
        // Auto-assign + toast the user about it
        try {
          const bm = await autoAssignBookmark();
          toast(`נוצרה לך סימנייה: ${bm.name}`);
        } catch (e) {
          toast('משהו השתבש, נסו שוב');
          if (btnEl) btnEl.disabled = false;
          return;
        }
      }
      // Whether committed or auto-assigned, record the gate now.
      await recordGateProgress(gateNum);
      maybeFireCompletion(gateEl);
      maybeFireEndOfAvailable(gateEl);
    });
  }


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
  function init() {
    installChip();
    applyGateState();        // Render gates from local state immediately
    syncGateStateFromServer(); // Then re-sync from server (server wins if higher)

    // Tell other widgets (feedback.js) who this reader is, even on a
    // plain page reload. Without this dispatch, identity-aware widgets
    // would only be notified on identity *changes* (create / resume /
    // auto-assign), not on the much more common "reader returns with
    // localStorage already populated" path — and their highlights
    // would never re-paint on refresh.
    if (state.bookmark_id) {
      try {
        window.dispatchEvent(new CustomEvent('bm:identity-changed', { detail: { ...state } }));
      } catch (_) {}
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
console.log("bookmark.js loaded");

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('saveBtn');

  if (!btn) {
    console.error("saveBtn not found");
    return;
  }

  btn.addEventListener('click', () => {
    fetch('/api/bookmark?url=' + encodeURIComponent(window.location.href))
      .then(res => res.json())
      .then(data => {
        console.log("API response:", data);
        alert('Saved!');
      })
      .catch(err => console.error("API error:", err));
  });
});