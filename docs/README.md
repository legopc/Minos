# Patchbox Documentation

mdbook scaffold for s7-ops-docs-site.

## Layout

- `src/SUMMARY.md` — table of contents
- `src/intro.md` — overview
- `src/user/` — user manual (mixing, routing, zones, scenes, DSP)
- `src/api/` — API reference (generated from OpenAPI — s7-ops-openapi)
- `src/ops/` — deployment, backup, RBAC, updates

## Build

```bash
cargo install mdbook
mdbook build docs/
mdbook serve docs/        # http://localhost:3000
```
