(() => {
  function createActivationHandlers({
    makeFallbackDiagnostic,
    sendTabMessageSafe,
    surfaceBackgroundDiagnostic,
    SITE_HIGHLIGHT_OVERRIDES_KEY,
    SITE_CONTENT_SCRIPTS_KEY,
  }) {
    function contentScriptId(origin) {
      let hash = 2166136261;
      for (const character of origin) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
      }
      return `polycast-site-${(hash >>> 0).toString(16)}`;
    }

    function optionalSiteFromUrl(pageUrl, expectedHostname) {
      let url;
      try { url = new URL(pageUrl); } catch { throw new Error('The active page URL is invalid'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== expectedHostname) {
        throw new Error('The requested site origin does not match the active page');
      }
      return { origin: url.origin, pattern: `${url.origin}/*` };
    }

    async function activateOptionalSite({ pageUrl, hostname, tabId }) {
      if (!chrome.scripting || !chrome.permissions) throw new Error('This browser does not support on-demand content activation');
      const { origin, pattern } = optionalSiteFromUrl(pageUrl, hostname);
      const permitted = await chrome.permissions.contains({ origins: [pattern] });
      if (!permitted) throw new Error(`Permission for ${origin} has not been granted`);
      const stored = await chrome.storage.local.get(SITE_CONTENT_SCRIPTS_KEY);
      const registrations = { ...(stored[SITE_CONTENT_SCRIPTS_KEY] || {}) };
      const id = registrations[origin] || contentScriptId(origin);
      const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
      const registeredNow = existing.length === 0;
      if (registeredNow) {
        await chrome.scripting.registerContentScripts([{
          id,
          matches: [pattern],
          js: ['shared/textTokens.js', 'shared/wordPopupCore.js', 'content/shared.js', 'content/selection.js', 'content/pageHighlights.js'],
          css: ['shared/wordPopup.css', 'overlay.css'],
          runAt: 'document_idle',
          persistAcrossSessions: true,
        }]);
      }
      registrations[origin] = id;
      await chrome.storage.local.set({ [SITE_CONTENT_SCRIPTS_KEY]: registrations });
      // Registration affects future navigations. Inject once into the active tab
      // so the explicit user action takes effect immediately.
      if (registeredNow && Number.isInteger(tabId)) {
        await chrome.scripting.insertCSS({ target: { tabId }, files: ['shared/wordPopup.css', 'overlay.css'] });
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['shared/textTokens.js', 'shared/wordPopupCore.js', 'content/shared.js', 'content/selection.js', 'content/pageHighlights.js'],
        });
      }
      return { origin, pattern, id };
    }

    async function deactivateOptionalSite(pageUrl, hostname) {
      if (!pageUrl || !chrome.scripting) return;
      const { origin } = optionalSiteFromUrl(pageUrl, hostname);
      const stored = await chrome.storage.local.get(SITE_CONTENT_SCRIPTS_KEY);
      const registrations = { ...(stored[SITE_CONTENT_SCRIPTS_KEY] || {}) };
      const id = registrations[origin];
      if (!id) return;
      await chrome.scripting.unregisterContentScripts({ ids: [id] });
      delete registrations[origin];
      await chrome.storage.local.set({ [SITE_CONTENT_SCRIPTS_KEY]: registrations });
    }

    chrome.contextMenus?.onClicked.addListener((info, tab) => {
      if (info.menuItemId !== SELECTION_CONTEXT_MENU_ID || !tab?.id) return;

      const message = {
        type: 'POLYCAST_LOOKUP_SELECTION',
        selectionText: info.selectionText || '',
        requestedAt: Date.now(),
      };
      const options = Number.isInteger(info.frameId) ? { frameId: info.frameId } : undefined;
      chrome.tabs.sendMessage(tab.id, message, options)
        .then((response) => {
          if (Number.isFinite(response?.shellLatencyMs)) {
          }
        })
        .catch(async (frameError) => {
          if (!options) return;
          // Chrome's PDF viewer reports selections from its internal extension
          // frame, where our content script cannot run. Retry in the top page
          // with the selectionText supplied by contextMenus.
          const diagnostic = makeFallbackDiagnostic({
            code: 'selection_top_frame_fallback',
            title: 'Selection frame fallback used',
            message: 'The selected frame could not host the lookup, so Polycast retried in the top page.',
            operation: 'open-selection-popup',
            detail: `frameId=${info.frameId}; reason=${frameError?.message || 'content script unavailable'}`,
          });
          console.warn('[polycast:fallback]', diagnostic);
          await surfaceBackgroundDiagnostic(diagnostic);
          return chrome.tabs.sendMessage(tab.id, message)
            .then((response) => {
              if (Number.isFinite(response?.shellLatencyMs)) {
              }
              void sendTabMessageSafe(tab.id, { type: 'POLYCAST_FALLBACK_NOTICE', diagnostic }, 'selection-fallback-notice');
            })
            .catch((error) => {
              const unavailableDiagnostic = makeFallbackDiagnostic({
                code: 'selection_popup_unavailable',
                title: 'Selection lookup unavailable',
                message: 'Polycast could not open the selection lookup in this page.',
                operation: 'open-selection-popup',
                detail: error?.message || 'content script unavailable',
                severity: 'error',
              });
              console.warn('[polycast:fallback]', unavailableDiagnostic);
              void surfaceBackgroundDiagnostic(unavailableDiagnostic);
            });
        });
    });


    return { activateOptionalSite, deactivateOptionalSite };
  }
  globalThis.PolycastActivationHandlers = { create: createActivationHandlers };
})();
