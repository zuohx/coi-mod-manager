# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Captain of Industry Mod Manager - A Tauri-based desktop application for managing game mods. Built with React + TypeScript frontend and a Node.js server-side API layer.

## Development Commands

```bash
# Development
pnpm dev          # Start Vite dev server on port 5173
pnpm tauri:dev    # Start Tauri development mode

# Build & Test
pnpm build        # TypeScript check + Vite build
pnpm test         # Run vitest tests
pnpm tauri:build  # Build Tauri desktop app

# Run single test file
pnpm vitest run src/test/domain/parse-manifest.test.ts
```

## Architecture

### Tech Stack
- **Frontend**: React 19 + TypeScript + Vite
- **Desktop**: Tauri 2.x
- **Testing**: Vitest + jsdom + @testing-library/react
- **Styling**: CSS with CSS custom properties for theming

### Project Structure

```
src/
├── adapters/           # External service implementations
│   ├── file/           # File system access (directory picker, manifest reader)
│   ├── cohub/          # COI Hub API client
│   └── platform/       # Platform capability detection
├── domain/
│   └── mod/            # Core business logic (types, manifest parsing, status computation)
├── features/
│   └── mod-status/     # Main feature module
│       ├── model/      # API client and React hooks
│       └── ui/         # UI components (ModStatusPage)
├── shared/
│   └── lib/            # Shared utilities (Result type, semver parsing)
├── app/                # App shell (providers, routes)
└── test/               # Test files (mirrors src/ structure)

server/
└── mod-api.ts          # Express-like server plugin for Vite (mod operations API)
```

### Key Concepts

- **Feature-sliced design**: Features are self-contained modules with `model/` and `ui/` subdirectories
- **Path alias**: `@/` maps to `src/` (configured in tsconfig.json and vite.config.ts)
- **Server plugin**: `server/mod-api.ts` is a Vite plugin that provides mod management API endpoints
- **Theming**: CSS custom properties in `:root` and `[data-theme="dark"]` for light/dark mode
- **Icons**: SVG icons embedded as data URIs in CSS (no icon library)

### Testing

Tests use `vitest` with `jsdom` environment. Test files are co-located with source in `src/test/` directory following the same structure as `src/`.

## Important Notes

- The `@tauri-apps/api` package provides Tauri runtime APIs
- Server-side code in `server/` runs in Vite's Node.js environment
- Mod operations (scan, upgrade, check) are handled by the server plugin
- COI Hub integration requires browser cookies for authentication
