// The desktop shell. For now it hosts the same web app; native file access
// (open/save .keizu files on disk) arrives in phase 2.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Keizu");
}
