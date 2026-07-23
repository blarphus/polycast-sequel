# Extension activation and host access

Polycast loads its subtitle integration automatically only on YouTube and Netflix. The local-development app bridge is limited to the localhost origins listed in `manifest.json`.

Polycast does not scan or highlight text on ordinary web pages. When a user explicitly chooses the Polycast context-menu item for selected text, Chrome grants temporary `activeTab` access and the extension injects only the one-time selection lookup runtime into that tab.

Every background/content boundary validates message type, sender where security-sensitive, field types, and size limits. Rejected messages return and display a structured `extension_message_rejected`, `content_message_rejected`, or surface-specific diagnostic with a correlation ID.
