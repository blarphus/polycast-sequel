# Extension activation, page-language detection, and host access

Polycast loads its subtitle integration automatically on YouTube and Netflix. On other HTTP and HTTPS websites, Polycast reads a bounded sample of the visible page text and asks Chrome's built-in `chrome.i18n.detectLanguage` API to identify the primary language. Ordinary-page highlighting activates only when Chrome reports a reliable primary language above 50% and that language matches the signed-in profile's target language.

On a qualifying target-language page, Polycast tokenizes readable page text locally and sends bounded token batches only to its own extension service worker, where they are compared with the locally cached saved-word/form index. The page text and language-detection sample are not sent to Polycast's server for highlighting. Matching words receive an in-page marker; clicking one uses the shared Polycast dictionary popup. Form controls, editable regions, scripts, styles, and code samples are excluded.

The Polycast web app and local-development origins are excluded from ordinary-page highlighting. Right-click selection lookup continues to use the shared popup runtime.

Every background/content boundary validates message type, sender where security-sensitive, field types, and size limits. Rejected messages return and display a structured `extension_message_rejected`, `content_message_rejected`, or surface-specific diagnostic with a correlation ID.
