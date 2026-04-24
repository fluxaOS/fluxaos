# Architectural Standards — fluxaos

## Vendor-Agnostic Integration Standard

All new integrations (memory ingest, platform clients, AI agents) MUST follow the capability + plugin pattern. Vendor-specific code lives in plugin files; module boundaries, CLI commands, HTTP routes, and config keys stay vendor-neutral.

**Canonical text:** `/mnt/dev/fh-commons/ARCHITECTURAL_STANDARDS.md` → "Vendor-Agnostic Integration Standard" section.

**Allowlisted exceptions:** hippo (UI branding), git (infrastructure). See canonical text.
