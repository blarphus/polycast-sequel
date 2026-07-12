# Extension activation and host access

Polycast loads its subtitle integration automatically only on YouTube and Netflix. The local-development app bridge is limited to the localhost origins listed in `manifest.json`.

Ordinary web pages are opt-in. Opening the extension popup gives Chrome temporary `activeTab` access so the popup can identify the current origin. Choosing **Auto** or **On** requests that origin through `optional_host_permissions`, registers the selection/highlight scripts for that exact origin, and injects them into the current tab. Choosing **Off** unregisters the persistent script for that origin; Chrome's extension settings remain the authoritative place to revoke the optional host permission itself. Already-running page code cannot be unloaded, so **Off** also sends a bounded disable update to the current page and prevents injection after its next navigation.

The ordinary-page scripts scan visible text for locally indexed saved-word tokens. They cap each scan, mutation batch, message size, token batch, and number of highlight ranges. They do not read password/form controls, and remote values used in fallback notices are rendered with `textContent`.

Every background/content boundary validates message type, sender where security-sensitive, field types, and size limits. Rejected messages return and display a structured `extension_message_rejected`, `content_message_rejected`, or surface-specific diagnostic with a correlation ID. Permission denial is visible as `site_activation_permission_denied`; it is never presented as successful activation.
