use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// 用系统默认程序打开路径
#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|error| error.to_string())
}
