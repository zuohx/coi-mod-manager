# Tauri Migration Notes

## Local development

- Old: `npm run dev`
- New desktop flow: `npm run tauri:dev`
- `tauri dev` starts the Vite dev server and then launches the desktop shell.
- Frontend edits still use Vite hot reload.
- Rust-side changes recompile the Tauri backend before reload.

## Windows prerequisites

- Rust toolchain with MSVC target
- Microsoft C++ Build Tools with "Desktop development with C++"
- Microsoft Edge WebView2 runtime

## Current scope

- This commit only adds the Tauri shell and build wiring.
- Native file scanning, default Mods path loading, and in-app upgrade flow still need native commands and permissions.
