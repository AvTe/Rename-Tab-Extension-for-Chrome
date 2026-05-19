/* ═══════════════════════════════════════════════
   TabRename Pro — Popup Controller
   Features: rename, search, drag-and-drop tab & window reordering
   ═══════════════════════════════════════════════ */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────

let allWindows  = [];
let renames     = {};
let searchOpen  = false;
let searchQuery = '';
let editingTab  = null;

// Drag state
const drag = {
  type: null,       // 'tab' | 'window'
  tabId: null,
  winId: null,
  fromIndex: null,
  fromWinId: null,
  sourceEl: null,
  indicator: null,  // current drop-indicator DOM node
  winZone: null,    // current window-drop-zone DOM node
};

// ─── DOM refs ─────────────────────────────────────────────────────────────

const $  = (id) => document.getElementById(id);
const windowsList  = $('windowsList');
const loader       = $('loader');
const emptyState   = $('emptyState');
const searchToggle = $('searchToggleBtn');
const searchWrap   = $('searchWrap');
const searchInput  = $('searchInput');
const searchClear  = $('searchClearBtn');
const clearAllBtn  = $('clearAllBtn');
const tabCount     = $('tabCount');

// Modal
const overlay        = $('modalOverlay');
const modalUrl       = $('modalUrl');
const modalFavicon   = $('modalFavicon');
const renameInput    = $('renameInput');
const charCount      = $('charCount');
const currentOrig    = $('currentOriginal');
const applyBtn       = $('applyRenameBtn');
const clearRenameBtn = $('clearRenameBtn');
const modalCloseBtn  = $('modalCloseBtn');

// Toast
const toastEl = $('toast');
let toastTimer = null;

// ─── Utilities ────────────────────────────────────────────────────────────

function showToast(msg, type = '') {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.className = `toast ${type}`;
  requestAnimationFrame(() => toastEl.classList.add('show'));
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

function truncateUrl(url, max = 45) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const short = u.hostname + (u.pathname !== '/' ? u.pathname : '');
    return short.length > max ? short.slice(0, max) + '…' : short;
  } catch {
    return url.length > max ? url.slice(0, max) + '…' : url;
  }
}

function faviconFor(tab) {
  if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
    return tab.favIconUrl;
  }
  try {
    const origin = new URL(tab.url).origin;
    return `https://www.google.com/s2/favicons?domain=${origin}&sz=32`;
  } catch {
    return null;
  }
}

function sendMsg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => resolve(res));
  });
}

// ─── Data Loading ─────────────────────────────────────────────────────────

async function loadData() {
  const response = await sendMsg({ type: 'GET_ALL_DATA' });
  return response || { windows: [], renames: {}, windowOrder: [] };
}

// ─── Favicon helpers ──────────────────────────────────────────────────────

function buildFaviconEl(tab, size = 18) {
  const src = faviconFor(tab);
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.className = 'tab-favicon';
    img.width = size; img.height = size;
    img.draggable = false;
    img.onerror = () => img.replaceWith(buildPlaceholder(size));
    return img;
  }
  return buildPlaceholder(size);
}

function buildPlaceholder(size = 18) {
  const div = document.createElement('div');
  div.className = 'tab-favicon-placeholder';
  div.style.width = div.style.height = `${size}px`;
  div.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18"/></svg>`;
  return div;
}

// ─── Drop Indicator helpers ───────────────────────────────────────────────

function removeIndicator() {
  if (drag.indicator) { drag.indicator.remove(); drag.indicator = null; }
}

function insertIndicatorBefore(el) {
  removeIndicator();
  const ind = document.createElement('div');
  ind.className = 'drop-indicator';
  el.parentNode.insertBefore(ind, el);
  drag.indicator = ind;
}

function insertIndicatorAfter(el) {
  removeIndicator();
  const ind = document.createElement('div');
  ind.className = 'drop-indicator';
  el.parentNode.insertBefore(ind, el.nextSibling);
  drag.indicator = ind;
}

function removeWindowZone() {
  if (drag.winZone) { drag.winZone.remove(); drag.winZone = null; }
}

function insertWindowZoneBefore(el) {
  removeWindowZone();
  const zone = document.createElement('div');
  zone.className = 'window-drop-zone';
  el.parentNode.insertBefore(zone, el);
  drag.winZone = zone;
}

function insertWindowZoneAfter(el) {
  removeWindowZone();
  const zone = document.createElement('div');
  zone.className = 'window-drop-zone';
  el.parentNode.insertBefore(zone, el.nextSibling);
  drag.winZone = zone;
}

// ─── TAB DRAG & DROP ─────────────────────────────────────────────────────

function initTabDrag(tabEl, tabId, winId, tabIndex) {
  tabEl.draggable = true;

  tabEl.addEventListener('dragstart', (e) => {
    drag.type      = 'tab';
    drag.tabId     = tabId;
    drag.winId     = winId;
    drag.fromIndex = tabIndex;
    drag.fromWinId = winId;
    drag.sourceEl  = tabEl;

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(tabId));

    requestAnimationFrame(() => tabEl.classList.add('dragging'));
  });

  tabEl.addEventListener('dragend', () => {
    tabEl.classList.remove('dragging');
    removeIndicator();
    drag.type = null;
    drag.sourceEl = null;
  });

  tabEl.addEventListener('dragover', (e) => {
    if (drag.type !== 'tab') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const rect = tabEl.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      insertIndicatorBefore(tabEl);
    } else {
      insertIndicatorAfter(tabEl);
    }
  });

  tabEl.addEventListener('dragleave', () => {
    // Only remove if leaving to outside this tab and no other target picked it up
    // We handle cleanup in dragend instead for smoothness
  });

  tabEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (drag.type !== 'tab' || drag.tabId == null) return;
    removeIndicator();

    const targetTabId    = tabId;
    const targetWinId    = winId;
    const targetTabIndex = tabIndex;
    const sourceTabId    = drag.tabId;
    const sourceWinId    = drag.fromWinId;

    if (sourceTabId === targetTabId) return;

    // Compute drop position
    const rect = tabEl.getBoundingClientRect();
    const dropBefore = e.clientY < rect.top + rect.height / 2;
    const toIndex = dropBefore ? targetTabIndex : targetTabIndex + 1;

    // Optimistic local update
    const srcWin = allWindows.find(w => w.id === sourceWinId);
    const tgtWin = allWindows.find(w => w.id === targetWinId);
    if (!srcWin || !tgtWin) return;

    const tabObj = srcWin.tabs.find(t => t.id === sourceTabId);
    if (!tabObj) return;

    // Remove from source
    srcWin.tabs = srcWin.tabs.filter(t => t.id !== sourceTabId);

    // Insert into target
    const insertAt = dropBefore ? tgtWin.tabs.findIndex(t => t.id === targetTabId)
                                : tgtWin.tabs.findIndex(t => t.id === targetTabId) + 1;
    tgtWin.tabs.splice(Math.max(0, insertAt), 0, tabObj);

    renderAll();

    // Persist via chrome.tabs.move
    const moveMsg = {
      type: 'MOVE_TAB',
      tabId: sourceTabId,
      toIndex: toIndex,
    };
    if (targetWinId !== sourceWinId) moveMsg.toWindowId = targetWinId;

    const res = await sendMsg(moveMsg);
    if (!res?.success) {
      showToast('Move failed — reloading…', 'error');
      await init();
    } else {
      showToast('Tab moved ✓', 'success');
    }
  });
}

// ─── WINDOW DRAG & DROP ───────────────────────────────────────────────────

function initWindowDrag(groupEl, winId) {
  const header = groupEl.querySelector('.window-drag-handle');
  if (!header) return;

  groupEl.draggable = false; // dragging is triggered by handle only

  header.addEventListener('mousedown', () => {
    groupEl.draggable = true;
  });
  header.addEventListener('mouseup', () => {
    setTimeout(() => { groupEl.draggable = false; }, 100);
  });

  groupEl.addEventListener('dragstart', (e) => {
    if (drag.type === 'tab') return; // tab drag takes priority
    drag.type     = 'window';
    drag.winId    = winId;
    drag.sourceEl = groupEl;

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'win-' + winId);

    requestAnimationFrame(() => groupEl.classList.add('window-dragging'));
  });

  groupEl.addEventListener('dragend', () => {
    groupEl.classList.remove('window-dragging');
    groupEl.draggable = false;
    removeWindowZone();
    drag.type = null;
    drag.sourceEl = null;
    document.querySelectorAll('.window-group').forEach(el =>
      el.classList.remove('drag-over-window')
    );
  });

  groupEl.addEventListener('dragover', (e) => {
    if (drag.type !== 'window' || drag.winId === winId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    document.querySelectorAll('.window-group').forEach(el =>
      el.classList.remove('drag-over-window')
    );
    groupEl.classList.add('drag-over-window');

    const rect = groupEl.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      insertWindowZoneBefore(groupEl);
    } else {
      insertWindowZoneAfter(groupEl);
    }
  });

  groupEl.addEventListener('dragleave', (e) => {
    if (!groupEl.contains(e.relatedTarget)) {
      groupEl.classList.remove('drag-over-window');
    }
  });

  groupEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (drag.type !== 'window' || drag.winId == null) return;
    removeWindowZone();
    groupEl.classList.remove('drag-over-window');

    const fromWinId = drag.winId;
    const toWinId   = winId;
    if (fromWinId === toWinId) return;

    // Reorder allWindows array
    const fromIdx = allWindows.findIndex(w => w.id === fromWinId);
    const toIdx   = allWindows.findIndex(w => w.id === toWinId);
    if (fromIdx === -1 || toIdx === -1) return;

    const rect = groupEl.getBoundingClientRect();
    const dropBefore = e.clientY < rect.top + rect.height / 2;
    const insertIdx = dropBefore ? toIdx : toIdx + 1;

    const [moved] = allWindows.splice(fromIdx, 1);
    allWindows.splice(insertIdx > fromIdx ? insertIdx - 1 : insertIdx, 0, moved);

    renderAll();

    // Persist the new order so it survives popup close/reopen
    await sendMsg({ type: 'SAVE_WINDOW_ORDER', order: allWindows.map(w => w.id) });
    showToast('Window order saved ✓', 'success');
  });
}

// ─── TAB DROP ZONE (tabs-list background) ────────────────────────────────

function initTabListDrop(tabsList, winId) {
  tabsList.addEventListener('dragover', (e) => {
    if (drag.type !== 'tab') return;
    const items = [...tabsList.querySelectorAll('.tab-item:not(.dragging)')];
    if (items.length === 0) {
      e.preventDefault();
      // Dropping into empty window
      removeIndicator();
    }
  });

  tabsList.addEventListener('drop', async (e) => {
    if (drag.type !== 'tab') return;
    const items = [...tabsList.querySelectorAll('.tab-item:not(.dragging)')];
    if (items.length > 0) return; // handled by individual tab items

    e.preventDefault();
    removeIndicator();

    const sourceTabId = drag.tabId;
    const targetWinId = winId;

    const srcWin = allWindows.find(w => w.id === drag.fromWinId);
    const tgtWin = allWindows.find(w => w.id === targetWinId);
    if (!srcWin || !tgtWin || sourceTabId == null) return;

    const tabObj = srcWin.tabs.find(t => t.id === sourceTabId);
    if (!tabObj) return;

    srcWin.tabs = srcWin.tabs.filter(t => t.id !== sourceTabId);
    tgtWin.tabs.push(tabObj);
    renderAll();

    // Use toIndex: 0 (not -1) — chrome.tabs.move treats -1 inconsistently
    const res = await sendMsg({ type: 'MOVE_TAB', tabId: sourceTabId, toIndex: 0, toWindowId: targetWinId });
    if (!res?.success) {
      showToast('Move failed — reloading…', 'error');
      await init();
    } else {
      showToast('Tab moved to window ✓', 'success');
    }
  });
}

// ─── Rendering ────────────────────────────────────────────────────────────

function filterTabs(tabs) {
  if (!searchQuery) return tabs;
  const q = searchQuery.toLowerCase();
  return tabs.filter(tab => {
    const name = (renames[String(tab.id)]?.title || tab.title || '').toLowerCase();
    const url  = (tab.url || '').toLowerCase();
    return name.includes(q) || url.includes(q);
  });
}

function renderTab(tab, winId, tabIndex) {
  const key     = String(tab.id);
  const renamed = renames[key];
  const displayName = renamed?.title || tab.title || '(No Title)';

  const item = document.createElement('div');
  item.className = 'tab-item' + (tab.active ? ' active-tab' : '');
  item.dataset.tabId = tab.id;

  // ── Drag handle ──
  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  handle.title = 'Drag to reorder';
  handle.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="9" cy="5" r="1" fill="currentColor"/><circle cx="15" cy="5" r="1" fill="currentColor"/>
    <circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/>
    <circle cx="9" cy="19" r="1" fill="currentColor"/><circle cx="15" cy="19" r="1" fill="currentColor"/>
  </svg>`;
  item.appendChild(handle);

  // Favicon
  item.appendChild(buildFaviconEl(tab));

  // Info
  const info = document.createElement('div');
  info.className = 'tab-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'tab-name' + (renamed ? ' renamed' : '');
  nameEl.textContent = displayName;
  nameEl.title = displayName;

  const urlEl = document.createElement('div');
  urlEl.className = 'tab-url';
  urlEl.textContent = truncateUrl(tab.url);

  info.appendChild(nameEl);
  info.appendChild(urlEl);
  item.appendChild(info);

  if (renamed) {
    const badge = document.createElement('span');
    badge.className = 'renamed-badge';
    badge.textContent = 'renamed';
    item.appendChild(badge);
  }

  // Actions
  const actions = document.createElement('div');
  actions.className = 'tab-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'tab-action-btn';
  editBtn.title = 'Rename this tab';
  editBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>`;
  editBtn.addEventListener('click', (e) => { e.stopPropagation(); openModal(tab, winId); });
  actions.appendChild(editBtn);

  if (renamed) {
    const clearBtn = document.createElement('button');
    clearBtn.className = 'tab-action-btn clear-btn';
    clearBtn.title = 'Reset to original';
    clearBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
    clearBtn.addEventListener('click', async (e) => { e.stopPropagation(); await clearTabRename(tab.id); });
    actions.appendChild(clearBtn);
  }

  item.appendChild(actions);

  // Click row → focus that tab (only if not a drag)
  item.addEventListener('click', (e) => {
    if (e.target.closest('.drag-handle') || e.target.closest('.tab-action-btn')) return;
    chrome.runtime.sendMessage({ type: 'FOCUS_TAB', tabId: tab.id, windowId: winId });
  });

  // Wire drag
  initTabDrag(item, tab.id, winId, tabIndex);

  return item;
}

function renderWindow(win, idx) {
  const isActive = win.focused;
  const tabsToRender = filterTabs(win.tabs || []);
  if (!tabsToRender.length && searchQuery) return null;

  const group = document.createElement('div');
  group.className = 'window-group';
  group.dataset.windowId = win.id;

  // ── Window Header ──
  const header = document.createElement('div');
  header.className = 'window-header';

  // Window drag handle (dots icon)
  const winHandle = document.createElement('div');
  winHandle.className = 'window-drag-handle';
  winHandle.title = 'Drag to reorder windows';
  winHandle.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="9" cy="5" r="1" fill="currentColor"/><circle cx="15" cy="5" r="1" fill="currentColor"/>
    <circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/>
    <circle cx="9" cy="19" r="1" fill="currentColor"/><circle cx="15" cy="19" r="1" fill="currentColor"/>
  </svg>`;

  const titleWrap = document.createElement('div');
  titleWrap.className = 'window-title-wrap';

  const badge = document.createElement('div');
  badge.className = 'window-badge' + (isActive ? '' : ' inactive');

  const label = document.createElement('span');
  label.className = 'window-label';
  label.textContent = `Window ${idx + 1}${isActive ? ' (Active)' : ''}`;

  const meta = document.createElement('span');
  meta.className = 'window-meta';
  const tc = (win.tabs || []).length;
  meta.textContent = ` · ${tc} tab${tc !== 1 ? 's' : ''}`;

  titleWrap.appendChild(badge);
  titleWrap.appendChild(label);
  titleWrap.appendChild(meta);

  const chevron = document.createElement('div');
  chevron.className = 'window-chevron';
  chevron.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;

  header.appendChild(winHandle);
  header.appendChild(titleWrap);
  header.appendChild(chevron);
  group.appendChild(header);

  // ── Tabs List ──
  const tabsList = document.createElement('div');
  tabsList.className = 'tabs-list';

  tabsToRender.forEach((tab, tIdx) => {
    // Use the tab's actual index in the full tabs array for chrome.tabs.move()
    const actualIndex = (win.tabs || []).findIndex(t => t.id === tab.id);
    tabsList.appendChild(renderTab(tab, win.id, actualIndex === -1 ? tIdx : actualIndex));
  });

  tabsList.style.maxHeight = '9999px';
  group.appendChild(tabsList);

  // Collapse toggle (avoid drag handle)
  header.addEventListener('click', (e) => {
    if (e.target.closest('.window-drag-handle')) return;
    if (group.classList.contains('collapsed')) {
      // Expanding: capture content height before removing 'collapsed'
      // scrollHeight is valid even under max-height:0 (reflects full content)
      group.classList.remove('collapsed');
      tabsList.style.maxHeight = tabsList.scrollHeight + 'px';
    } else {
      // Collapsing: snap to explicit height first, then animate to 0
      tabsList.style.maxHeight = tabsList.scrollHeight + 'px';
      requestAnimationFrame(() => { tabsList.style.maxHeight = '0'; });
      group.classList.add('collapsed');
    }
  });

  // Wire tab-list drop zone (for moving into empty windows)
  initTabListDrop(tabsList, win.id);

  // Wire window drag
  initWindowDrag(group, win.id);

  return group;
}

function renderAll() {
  windowsList.innerHTML = '';
  let totalTabs = 0;
  let rendered  = 0;

  allWindows.forEach((win, idx) => {
    totalTabs += (win.tabs || []).length;
    const el = renderWindow(win, idx);
    if (el) { windowsList.appendChild(el); rendered++; }
  });

  const renamedCount = Object.keys(renames).length;
  tabCount.textContent =
    `${totalTabs} tab${totalTabs !== 1 ? 's' : ''} · ${allWindows.length} window${allWindows.length !== 1 ? 's' : ''}` +
    (renamedCount ? ` · ${renamedCount} renamed` : '');

  emptyState.style.display = (searchQuery && rendered === 0) ? 'flex' : 'none';
  loader.style.display = 'none';
}

// ─── Init ─────────────────────────────────────────────────────────────────

async function init() {
  const { windows, renames: storedRenames, windowOrder } = await loadData();

  // Restore persisted window order; fall back to active-window-first
  if (windowOrder && windowOrder.length) {
    allWindows = windows.sort((a, b) => {
      const ai = windowOrder.indexOf(a.id);
      const bi = windowOrder.indexOf(b.id);
      if (ai === -1 && bi === -1) return (b.focused ? 1 : 0) - (a.focused ? 1 : 0);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  } else {
    allWindows = windows.sort((a, b) => (b.focused ? 1 : 0) - (a.focused ? 1 : 0));
  }

  renames = storedRenames || {};
  renderAll();
}

// ─── Search ───────────────────────────────────────────────────────────────

searchToggle.addEventListener('click', () => {
  searchOpen = !searchOpen;
  searchWrap.classList.toggle('open', searchOpen);
  searchToggle.classList.toggle('active', searchOpen);
  if (searchOpen) setTimeout(() => searchInput.focus(), 50);
  else {
    searchQuery = '';
    searchInput.value = '';
    searchClear.style.display = 'none';
    renderAll();
  }
});

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim();
  searchClear.style.display = searchQuery ? 'block' : 'none';
  renderAll();
});

searchClear.addEventListener('click', () => {
  searchQuery = '';
  searchInput.value = '';
  searchClear.style.display = 'none';
  searchInput.focus();
  renderAll();
});

// ─── Clear All ────────────────────────────────────────────────────────────

clearAllBtn.addEventListener('click', async () => {
  const count = Object.keys(renames).length;
  if (!count) { showToast('No renamed tabs to clear', ''); return; }
  await sendMsg({ type: 'CLEAR_ALL' });
  renames = {};
  showToast(`Cleared ${count} rename${count !== 1 ? 's' : ''}`, 'success');
  await init();
});

// ─── Modal ────────────────────────────────────────────────────────────────

function openModal(tab, windowId) {
  editingTab = { tabId: tab.id, windowId, url: tab.url };

  const existing = renames[String(tab.id)]?.title;
  const original = tab.title || '(No Title)';

  modalUrl.textContent = truncateUrl(tab.url, 50);

  modalFavicon.innerHTML = '';
  modalFavicon.appendChild(buildFaviconEl(tab, 18));

  renameInput.value = existing || original;
  updateCharCount();
  currentOrig.textContent = existing ? `Original: "${original}"` : '';

  overlay.classList.add('open');
  setTimeout(() => { renameInput.focus(); renameInput.select(); }, 60);
}

function closeModal() {
  overlay.classList.remove('open');
  editingTab = null;
}

function updateCharCount() {
  charCount.textContent = `${renameInput.value.length}/80`;
}

renameInput.addEventListener('input', updateCharCount);
renameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyRename();
  if (e.key === 'Escape') closeModal();
});

modalCloseBtn.addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
applyBtn.addEventListener('click', applyRename);
clearRenameBtn.addEventListener('click', async () => {
  if (!editingTab) return;
  await clearTabRename(editingTab.tabId);
  closeModal();
});

async function applyRename() {
  if (!editingTab) return;
  const newTitle = renameInput.value.trim();
  if (!newTitle) { showToast('Please enter a name', 'error'); return; }

  // Skip if nothing actually changed (Bug 5 fix)
  const existingTitle = renames[String(editingTab.tabId)]?.title;
  if (newTitle === existingTitle) {
    showToast('No changes to apply', '');
    closeModal();
    return;
  }

  applyBtn.disabled = true;
  applyBtn.textContent = 'Applying…';

  const response = await sendMsg({ type: 'RENAME_TAB', tabId: editingTab.tabId, title: newTitle });

  applyBtn.disabled = false;
  applyBtn.textContent = 'Apply Rename';

  if (response?.success) {
    renames[String(editingTab.tabId)] = { title: newTitle };
    showToast(`✓ Renamed to "${newTitle}"`, 'success');
    closeModal();
    await init();
  } else {
    showToast('Failed to rename tab', 'error');
  }
}

async function clearTabRename(tabId) {
  const response = await sendMsg({ type: 'CLEAR_RENAME', tabId });
  if (response?.success) {
    delete renames[String(tabId)];
    showToast('Tab name reset to original', '');
    await init();
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────

init();
