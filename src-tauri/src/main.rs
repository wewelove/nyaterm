// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Windows subsystem configuration and entry.
//! Delegates to `nyaterm_lib::run()` for the actual app.

fn main() {
    nyaterm_lib::run()
}
