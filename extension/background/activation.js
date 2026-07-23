(() => {
  function createActivationHandlers({
    makeFallbackDiagnostic,
    surfaceBackgroundDiagnostic,
  }) {
    const SELECTION_RUNTIME_FILES = [
      'shared/textTokens.js',
      'shared/wordPopupCore.js',
      'content/shared.js',
      'content/selection.js',
    ];
    const SELECTION_RUNTIME_CSS = ['shared/wordPopup.css', 'overlay.css'];

    function frameMessageOptions(frameId) {
      return Number.isInteger(frameId) ? { frameId } : undefined;
    }

    function frameScriptTarget(tabId, frameId) {
      return Number.isInteger(frameId) ? { tabId, frameIds: [frameId] } : { tabId };
    }

    async function injectSelectionRuntime(tabId, frameId) {
      const target = frameScriptTarget(tabId, frameId);
      await chrome.scripting.insertCSS({ target, files: SELECTION_RUNTIME_CSS });
      await chrome.scripting.executeScript({ target, files: SELECTION_RUNTIME_FILES });
    }

    async function sendSelectionLookup(tabId, message, frameId) {
      const response = await chrome.tabs.sendMessage(tabId, message, frameMessageOptions(frameId));
      if (response?.success) return response;
      const error = new Error(response?.error || 'The page listener did not open the selection popup');
      error.response = response;
      error.listenerResponded = true;
      throw error;
    }

    async function showStandaloneSelectionDiagnostic(tabId, frameId, diagnostic) {
      try {
        await chrome.scripting.executeScript({
          target: frameScriptTarget(tabId, frameId),
          args: [diagnostic],
          func: (notice) => {
            const existing = document.getElementById('polycast-selection-error-notice');
            if (existing) existing.remove();
            const toast = document.createElement('div');
            toast.id = 'polycast-selection-error-notice';
            toast.setAttribute('role', 'alert');
            Object.assign(toast.style, {
              position: 'fixed', right: '20px', top: '20px', zIndex: '2147483647',
              maxWidth: '380px', padding: '14px 16px', border: '1px solid #f87171',
              borderRadius: '10px', background: '#1f1720', color: '#fff',
              font: '14px/1.4 system-ui, sans-serif', boxShadow: '0 8px 28px #0008',
            });
            const title = document.createElement('strong');
            title.style.display = 'block';
            title.textContent = notice.title;
            const message = document.createElement('span');
            message.style.display = 'block';
            message.textContent = notice.message;
            const technical = document.createElement('small');
            technical.style.display = 'block';
            technical.style.marginTop = '6px';
            technical.style.opacity = '0.8';
            technical.textContent = `${notice.code} · ref ${notice.correlationId}`;
            toast.append(title, message, technical);
            document.documentElement.appendChild(toast);
            setTimeout(() => toast.remove(), 9000);
          },
        });
      } catch (error) {
        console.info('[polycast:fallback-delivery-failed]', {
          ...diagnostic,
          deliveryError: error?.message || String(error),
        });
      }
    }

    async function showSelectionRuntimeFallback(tabId, frameId, reason) {
      const diagnostic = makeFallbackDiagnostic({
        code: 'selection_runtime_injected',
        title: 'Selection runtime attached',
        message: 'Polycast attached its one-time lookup controls to this page after the initial handoff was unavailable.',
        operation: 'open-selection-popup',
        detail: `frameId=${Number.isInteger(frameId) ? frameId : 'top'}; reason=${reason}`,
      });
      console.info('[polycast:fallback]', diagnostic);
      await surfaceBackgroundDiagnostic(diagnostic);
      await chrome.tabs.sendMessage(
        tabId,
        { type: 'POLYCAST_FALLBACK_NOTICE', diagnostic },
        frameMessageOptions(frameId),
      );
    }

    async function surfaceSelectionRejection(error) {
      const diagnostic = makeFallbackDiagnostic({
        code: 'selection_popup_not_opened',
        title: 'Selection lookup not opened',
        message: error?.message || 'The page listener did not open the selection popup.',
        operation: 'open-selection-popup',
        severity: 'error',
      });
      console.info('[polycast:fallback]', diagnostic);
      await surfaceBackgroundDiagnostic(diagnostic);
    }

    chrome.contextMenus?.onClicked.addListener((info, tab) => {
      if (info.menuItemId !== SELECTION_CONTEXT_MENU_ID || !tab?.id) return;

      const message = {
        type: 'POLYCAST_LOOKUP_SELECTION',
        selectionText: info.selectionText || '',
        requestedAt: Date.now(),
      };
      void (async () => {
        const selectedFrameId = Number.isInteger(info.frameId) ? info.frameId : undefined;
        try {
          await sendSelectionLookup(tab.id, message, selectedFrameId);
          return;
        } catch (initialError) {
          if (initialError?.listenerResponded) {
            await surfaceSelectionRejection(initialError);
            return;
          }
          try {
            // Clicking an extension context-menu item grants activeTab access.
            // Attach the lookup runtime on demand so right-click lookup works on
            // ordinary pages without asking for persistent site access first.
            await injectSelectionRuntime(tab.id, selectedFrameId);
            await sendSelectionLookup(tab.id, message, selectedFrameId);
            await showSelectionRuntimeFallback(
              tab.id,
              selectedFrameId,
              initialError?.message || 'content script unavailable',
            );
            return;
          } catch (frameError) {
            if (frameError?.listenerResponded) {
              await surfaceSelectionRejection(frameError);
              return;
            }
            if (selectedFrameId !== undefined && selectedFrameId !== 0) {
              const diagnostic = makeFallbackDiagnostic({
                code: 'selection_top_frame_fallback',
                title: 'Selection frame fallback used',
                message: 'The selected frame could not host the lookup, so Polycast retried in the top page.',
                operation: 'open-selection-popup',
                detail: `frameId=${selectedFrameId}; reason=${frameError?.message || 'content script unavailable'}`,
              });
              console.info('[polycast:fallback]', diagnostic);
              await surfaceBackgroundDiagnostic(diagnostic);
              try {
                await injectSelectionRuntime(tab.id, 0);
                await sendSelectionLookup(tab.id, message, 0);
                await chrome.tabs.sendMessage(
                  tab.id,
                  { type: 'POLYCAST_FALLBACK_NOTICE', diagnostic },
                  { frameId: 0 },
                );
                return;
              } catch (topFrameError) {
                frameError = topFrameError;
              }
            }

            const unavailableDiagnostic = makeFallbackDiagnostic({
              code: 'selection_popup_unavailable',
              title: 'Selection lookup unavailable',
              message: 'Polycast could not open the selection lookup in this page.',
              operation: 'open-selection-popup',
              detail: frameError?.message || 'content script unavailable',
              severity: 'error',
            });
            console.info('[polycast:fallback]', unavailableDiagnostic);
            await surfaceBackgroundDiagnostic(unavailableDiagnostic);
            await showStandaloneSelectionDiagnostic(tab.id, selectedFrameId, unavailableDiagnostic);
          }
        }
      })();
    });


    return {};
  }
  globalThis.PolycastActivationHandlers = { create: createActivationHandlers };
})();
