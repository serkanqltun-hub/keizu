// The desktop shell. It hosts the same web app and adds what a browser
// can't do: reading and writing .keizu files anywhere on disk, and opening
// a file the user double-clicked (passed on the command line, or by the
// "open document" event on macOS).

mod ai;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::ipc::{InvokeBody, Request, Response};

/// Files the app was asked to open before the web view could take them.
#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);

#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

/// Writes the raw request body to the path given in the `path` header
/// (URI-encoded). Writes to a temporary file first, then renames, so a crash
/// mid-write never leaves a half-written map behind.
#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("beklenen ham veri".into());
    };
    let encoded = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .ok_or("dosya yolu eksik")?;
    let path = PathBuf::from(percent_decode(encoded));
    let tmp = path.with_extension("keizu-tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

#[tauri::command]
fn take_opened_files(state: tauri::State<'_, PendingFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Some(b) = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn is_map_file(arg: &str) -> bool {
    let lower = arg.to_lowercase();
    [".keizu", ".json", ".xmind", ".opml", ".md"].iter().any(|ext| lower.ends_with(ext))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let from_args: Vec<String> = std::env::args().skip(1).filter(|a| is_map_file(a)).collect();
    let mut builder = tauri::Builder::default();
    // A second launch (a double-clicked file, or a keizu://connect link on
    // Windows and Linux) hands its arguments to the running window instead.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::{Emitter, Manager};
            let files: Vec<String> = argv.iter().skip(1).filter(|a| is_map_file(a)).cloned().collect();
            if !files.is_empty() {
                if let Some(state) = app.try_state::<PendingFiles>() {
                    state.0.lock().unwrap().extend(files.clone());
                }
                let _ = app.emit("open-files", files);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }));
        // Updates come from GitHub Releases (see tauri.conf.json → plugins.updater);
        // the process plugin restarts the app once an update is installed.
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }
    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            // Installed builds register keizu:// at install time; this covers
            // development runs and AppImage on Linux, and Windows.
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = _app.deep_link().register_all();
            }
            Ok(())
        })
        .manage(PendingFiles(Mutex::new(from_args)))
        .manage(ai::AiJobs::default())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            take_opened_files,
            ai::ai_detect,
            ai::ai_run,
            ai::ai_cancel,
            ai::ai_login
        ])
        .build(tauri::generate_context!())
        .expect("error while building Keizu")
        .run(|_app, _event| {
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = &_event {
                use tauri::{Emitter, Manager};
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                if let Some(state) = _app.try_state::<PendingFiles>() {
                    state.0.lock().unwrap().extend(paths.clone());
                }
                let _ = _app.emit("open-files", paths);
            }
        });
}
