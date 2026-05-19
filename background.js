// TabRename Pro - Background Service Worker
// Handles tab rename storage, window order, and cross-window messaging

const STORAGE_KEY        = 'tabRenames';
const WINDOW_ORDER_KEY   = 'windowOrder';

// ─── Helpers ───────────────────────────────────────────────────────────────

async function getRenames() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || {};
}

async function saveRenames(renames) {
  await chrome.storage.local.set({ [STORAGE_KEY]: renames });
}

// ─── Window Order helpers ──────────────────────────────────────────────────

async function getWindowOrder() {
  const result = await chrome.storage.local.get(WINDOW_ORDER_KEY);
  return result[WINDOW_ORDER_KEY] || [];
}

async function saveWindowOrder(order) {
  await chrome.storage.local.set({ [WINDOW_ORDER_KEY]: order });
}

// ─── Apply rename via content script, with executeScript fallback ──────────

async function applyRenameToTab(tabId, title) {
  // Primary path: message the already-running content script (reliable in MV3)
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SET_TITLE', title });
    return;
  } catch (_) {
    // Content script not ready or page is a special chrome:// URL — use fallback
  }

  // Fallback: inject code directly via scripting API
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (newTitle) => {
        document.title = newTitle;
        if (window.__tabRenameObserver) {
          window.__tabRenameObserver.disconnect();
        }
        const observer = new MutationObserver(() => {
          if (document.title !== newTitle) document.title = newTitle;
        });
        const titleEl = document.querySelector('title');
        if (titleEl) {
          observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
        } else {
          observer.observe(document.head || document.documentElement, {
            childList: true, subtree: true
          });
        }
        window.__tabRenameObserver = observer;
        window.__tabRenameTitle = newTitle;
      },
      args: [title]
    });
  } catch (e) {
    // Tab might be a special page (chrome://, etc.) — skip silently
    console.warn(`TabRename: Could not rename tab ${tabId}:`, e.message);
  }
}

// ─── Listeners ─────────────────────────────────────────────────────────────

// Re-apply renames when a tab finishes loading
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    const renames = await getRenames();
    const key = String(tabId);
    if (renames[key]) {
      await applyRenameToTab(tabId, renames[key].title);
    }
  }
});

// Clean up rename data when a tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const renames = await getRenames();
  const key = String(tabId);
  if (renames[key]) {
    delete renames[key];
    await saveRenames(renames);
  }
});

// ─── Message Handling ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'RENAME_TAB') {
        const { tabId, title } = message;
        const renames = await getRenames();

        if (title && title.trim()) {
          renames[String(tabId)] = {
            title: title.trim(),
            renamedAt: Date.now()
          };
          await saveRenames(renames);
          await applyRenameToTab(tabId, title.trim());
          sendResponse({ success: true });
        } else {
          // Clear rename
          delete renames[String(tabId)];
          await saveRenames(renames);
          // Reload to restore original title
          try { await chrome.tabs.reload(tabId); } catch (_) {}
          sendResponse({ success: true });
        }
      }

      else if (message.type === 'CLEAR_RENAME') {
        const { tabId } = message;
        const renames = await getRenames();
        delete renames[String(tabId)];
        await saveRenames(renames);
        try { await chrome.tabs.reload(tabId); } catch (_) {}
        sendResponse({ success: true });
      }

      else if (message.type === 'GET_ALL_DATA') {
        const [windows, renames, windowOrder] = await Promise.all([
          chrome.windows.getAll({ populate: true }),
          getRenames(),
          getWindowOrder()
        ]);
        sendResponse({ windows, renames, windowOrder });
      }

      else if (message.type === 'FOCUS_TAB') {
        const { tabId, windowId } = message;
        await chrome.windows.update(windowId, { focused: true });
        await chrome.tabs.update(tabId, { active: true });
        sendResponse({ success: true });
      }

      else if (message.type === 'CLEAR_ALL') {
        // Capture tab IDs BEFORE clearing so we can reload them
        const renames = await getRenames();
        const tabIds = Object.keys(renames).map(Number);
        await saveRenames({});
        // Restore original titles by reloading each formerly-renamed tab
        for (const tabId of tabIds) {
          try { await chrome.tabs.reload(tabId); } catch (_) {}
        }
        sendResponse({ success: true });
      }

      else if (message.type === 'SAVE_WINDOW_ORDER') {
        await saveWindowOrder(message.order);
        sendResponse({ success: true });
      }

      else if (message.type === 'MOVE_TAB') {
        // Move a tab to a new index within its window (or to another window)
        const { tabId, toIndex, toWindowId } = message;
        const moveProps = { index: toIndex };
        if (toWindowId !== undefined) moveProps.windowId = toWindowId;
        await chrome.tabs.move(tabId, moveProps);
        sendResponse({ success: true });
      }

    } catch (err) {
      console.error('TabRename background error:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Keep message channel open for async response
});

// ─── Init ──────────────────────────────────────────────────────────────────

// On startup, re-apply all stored renames
chrome.runtime.onStartup.addListener(async () => {
  const renames = await getRenames();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    const key = String(tab.id);
    if (renames[key]) {
      await applyRenameToTab(tab.id, renames[key].title);
    }
  }
});
