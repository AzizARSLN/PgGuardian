//! PgGuardian desktop shell (Tauri v2).
//!
//! The shell owns a single window and one child process: the PyInstaller-built
//! `pgguardian-desktop` sidecar. That sidecar runs the FastAPI app together with
//! the bundled static UI on a loopback port and prints
//!
//!     PGGUARDIAN_READY http://127.0.0.1:<port>
//!
//! on stdout once it is listening. The shell then points the window at that URL
//! so the UI and /api/v1 share a single origin (the refresh cookie keeps working)
//! and the embedded SQLite metadata store stays local to the machine.

// Hide the extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use url::Url;

const SIDECAR: &str = "pgguardian-desktop";
const READY_PREFIX: &str = "PGGUARDIAN_READY";
const ERROR_PREFIX: &str = "PGGUARDIAN_ERROR";

/// How long to wait for the sidecar before showing the window anyway.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

/// Handle kept so the sidecar can be killed once the app exits.
struct Sidecar(Mutex<Option<CommandChild>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();

            let sidecar = handle
                .shell()
                .sidecar(SIDECAR)
                .expect("sidecar 'pgguardian-desktop' is not bundled; build it first");
            let (mut rx, child) = sidecar.spawn().expect("failed to spawn the PgGuardian sidecar");
            app.manage(Sidecar(Mutex::new(Some(child))));

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            let line = String::from_utf8_lossy(&bytes);
                            if let Some(url) = line.trim().strip_prefix(READY_PREFIX) {
                                if let Ok(parsed) = Url::parse(url.trim()) {
                                    reveal(&handle, Some(parsed));
                                    return;
                                }
                            }
                        }
                        CommandEvent::Stderr(bytes) => {
                            let line = String::from_utf8_lossy(&bytes);
                            if line.contains(ERROR_PREFIX) {
                                eprintln!("{}", line.trim());
                                reveal(&handle, None);
                                return;
                            }
                        }
                        _ => {}
                    }
                }
            });

            // Safety net: never leave the user staring at an invisible window.
            let fallback = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(STARTUP_TIMEOUT);
                reveal(&fallback, None);
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the PgGuardian desktop shell")
        .run(|handle, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                if let Some(state) = handle.try_state::<Sidecar>() {
                    if let Some(child) = state.0.lock().expect("sidecar mutex").take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}

/// Point the main window at the sidecar (when known) and show it.
fn reveal(app: &AppHandle, url: Option<Url>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Some(url) = url {
        let _ = window.navigate(url);
    }
    let _ = window.show();
    let _ = window.set_focus();
}
