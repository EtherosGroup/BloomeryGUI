use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// 背景图文件名前缀，换扩展名时先清掉旧的
const STEM: &str = "background";

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

/// 已存在的背景图，按前缀找
fn existing(dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(STEM) && path.is_file() {
            return Some(path);
        }
    }
    None
}

/// 保存背景图，返回绝对路径
#[tauri::command]
pub fn save_background(app: AppHandle, bytes: Vec<u8>, extension: String) -> Result<String, String> {
    let dir = data_dir(&app)?;
    if let Some(previous) = existing(&dir) {
        fs::remove_file(previous).map_err(|error| error.to_string())?;
    }
    let suffix = extension.trim_start_matches('.').to_lowercase();
    let target = dir.join(format!("{STEM}.{suffix}"));
    fs::write(&target, bytes).map_err(|error| error.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

/// 删除背景图
#[tauri::command]
pub fn remove_background(app: AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    if let Some(previous) = existing(&dir) {
        fs::remove_file(previous).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// 现有背景图路径，没有则为 null
#[tauri::command]
pub fn background_path(app: AppHandle) -> Result<Option<String>, String> {
    let dir = data_dir(&app)?;
    Ok(existing(&dir).map(|path| path.to_string_lossy().to_string()))
}
