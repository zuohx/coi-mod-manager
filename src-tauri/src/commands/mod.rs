//! Tauri command modules for COI Mod Manager.
//!
//! These commands implement the server-side logic natively in Rust,
//! replacing the Node.js backend when running in Tauri desktop mode.

pub mod hub;
pub mod scan;
pub mod upgrade;
