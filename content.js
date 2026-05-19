// TabRename Pro - Content Script
// Listens for rename messages from background service worker

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SET_TITLE') {
    const newTitle = message.title;

    // Disconnect any previous observer
    if (window.__tabRenameObserver) {
      window.__tabRenameObserver.disconnect();
      window.__tabRenameObserver = null;
    }

    if (newTitle) {
      document.title = newTitle;
      window.__tabRenameTitle = newTitle;

      // Keep overriding if the page tries to change it back
      const observer = new MutationObserver(() => {
        if (document.title !== newTitle) {
          document.title = newTitle;
        }
      });

      const titleEl = document.querySelector('title');
      if (titleEl) {
        observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
      } else {
        observer.observe(document.head || document.documentElement, {
          childList: true,
          subtree: true
        });
      }
      window.__tabRenameObserver = observer;
    }

    sendResponse({ success: true });
  } else {
    sendResponse({ success: false });
  }

  // Keep channel open — required for async safety even if currently sync
  return true;
});
