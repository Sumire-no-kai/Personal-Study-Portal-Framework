# Public Framework Working Agreement

- This repository distributes source code and content-free examples, never a user's notes, course materials, generated manifests, local settings, indexes, credentials, or build output.
- The repository-root reader remains the static-site baseline. Windows embeds its own copy under `servers/desktop-windows/reader/`; changes there must not alter the root reader or the separately deployed private reader.
- Keep the root `.gitignore` allowlist narrow. Audit every newly allowed path before committing or packaging.
- The desktop app must read existing libraries without silently moving, rewriting, or deleting files. Explicit template creation must fail if a destination exists.
- Keep the desktop HTTP service on loopback, preserve its browser boundary checks, and treat Markdown and attachments as untrusted input.
- First launch must require acceptance of the current responsible-use notice and completion of the guide before selecting a library or starting the service.
- Run focused frontend and Rust checks before a Windows package. An unsigned CI-built installer is an alpha until clean-machine installation and runtime behavior are verified.
