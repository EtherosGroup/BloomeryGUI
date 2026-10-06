use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

/// 单个诊断文件上限，超过就轮转一份
const MAX_BYTES: u64 = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagInfo {
    pub path: String,
    pub size: u64,
}

fn diag_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("diag.log"))
}

/// 追加行：超过上限先把现有文件轮转一份（时间戳由调用方写入行内）
fn append_lines(path: &Path, lines: &[String], max: u64) -> io::Result<u64> {
    if let Ok(meta) = fs::metadata(path) {
        if meta.len() >= max {
            let rotated = path.with_extension("1.log");
            let _ = fs::remove_file(&rotated);
            fs::rename(path, rotated)?;
        }
    }

    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    for line in lines {
        writeln!(file, "{line}")?;
    }
    file.flush()?;
    Ok(fs::metadata(path).map(|meta| meta.len()).unwrap_or(0))
}

/// 追加诊断行
#[tauri::command]
pub fn append_diag(app: tauri::AppHandle, lines: Vec<String>) -> Result<DiagInfo, String> {
    let path = diag_path(&app)?;
    let size = append_lines(&path, &lines, MAX_BYTES).map_err(|error| error.to_string())?;
    Ok(DiagInfo {
        path: path.to_string_lossy().to_string(),
        size,
    })
}

/// 诊断文件路径与大小
#[tauri::command]
pub fn diag_info(app: tauri::AppHandle) -> Result<DiagInfo, String> {
    let path = diag_path(&app)?;
    let size = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    Ok(DiagInfo {
        path: path.to_string_lossy().to_string(),
        size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("diag-test-{}-{}.log", name, std::process::id()));
        path
    }

    #[test]
    fn appends_in_order() {
        let path = temp_path("append");
        let _ = fs::remove_file(&path);
        append_lines(&path, &["第一行".to_string()], MAX_BYTES).unwrap();
        let size = append_lines(&path, &["第二行".to_string()], MAX_BYTES).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert_eq!(text, "第一行\n第二行\n");
        assert_eq!(size, text.len() as u64);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn rotates_when_over_limit() {
        let path = temp_path("rotate");
        let rotated = path.with_extension("1.log");
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(&rotated);
        append_lines(&path, &["旧内容".to_string()], MAX_BYTES).unwrap();
        // 上限设成 1 字节，迫使下一次追加先轮转
        append_lines(&path, &["新内容".to_string()], 1).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "新内容\n");
        assert_eq!(fs::read_to_string(&rotated).unwrap(), "旧内容\n");
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(&rotated);
    }
}
