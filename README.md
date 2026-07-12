# Polycast

Polycast is a language-learning system with a React web client, Express/PostgreSQL server, iOS app and widget, Chrome extension, and a private Cloudflare media Worker.

Use Node 22.12.0 and XcodeGen. From a clean clone:

```sh
npm run setup
npm run check
```

Useful root commands are `setup`, `check`, `check:fast`, `format`, `audit`, `sbom`, `generate`, `check:xcodegen`, `clean:report`, and the confirmation-required `clean`. See `ARCHITECTURE.md` for ownership and `docs/DEPLOYMENT.md` for release/migration requirements.
