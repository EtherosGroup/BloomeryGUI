use std::fs;
use std::io::{Read, Seek, SeekFrom};

use serde::Serialize;

/// 单次读取的字节上限，避免把整份日志塞进 webview
const MAX_CHUNK: u64 = 256 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChunk {
    /// 起始偏移
    pub offset: u64,
    /// 本次读到的字节
    pub text: String,
    /// 读取后的文件大小
    pub size: u64,
    /// 是否还有更多内容
    pub truncated: bool,
}

/// 从 offset 起读取文本片段，日志这类只增文件按偏移续读
#[tauri::command]
pub fn read_text_file(path: String, offset: u64) -> Result<FileChunk, String> {
    let mut file = fs::File::open(&path).map_err(|error| error.to_string())?;
    let size = file.metadata().map_err(|error| error.to_string())?.len();

    if offset >= size {
        return Ok(FileChunk {
            offset,
            text: String::new(),
            size,
            truncated: false,
        });
    }

    file.seek(SeekFrom::Start(offset))
        .map_err(|error| error.to_string())?;

    let remaining = size - offset;
    let take = remaining.min(MAX_CHUNK);
    let mut buffer = vec![0u8; take as usize];
    let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
    buffer.truncate(read);

    Ok(FileChunk {
        offset,
        text: String::from_utf8_lossy(&buffer).to_string(),
        size,
        truncated: remaining > take,
    })
}

/// 建目录，已存在不报错
#[tauri::command]
pub fn ensure_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathStamp {
    pub exists: bool,
    /// 目录 mtime，毫秒；取不到为 0
    pub mtime: u64,
    /// 一级条目数
    pub entries: u64,
}

/// 目录指纹：mtime 加一级条目数，用来判断文件夹有没有变动
#[tauri::command]
pub fn path_stamps(paths: Vec<String>) -> Vec<PathStamp> {
    paths
        .iter()
        .map(|path| {
            let Ok(meta) = fs::metadata(path) else {
                return PathStamp {
                    exists: false,
                    mtime: 0,
                    entries: 0,
                };
            };
            let mtime = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|delta| delta.as_millis() as u64)
                .unwrap_or(0);
            let entries = fs::read_dir(path)
                .map(|rows| rows.count() as u64)
                .unwrap_or(0);
            PathStamp {
                exists: true,
                mtime,
                entries,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_directory_creates_and_repeats() {
        let mut path = std::env::temp_dir();
        path.push(format!("bloomery-dir-{}", std::process::id()));
        path.push("mods");
        let text = path.to_string_lossy().to_string();

        ensure_directory(text.clone()).unwrap();
        ensure_directory(text).unwrap();

        assert!(path.is_dir());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn path_stamps_counts_entries_and_marks_missing() {
        let mut dir = std::env::temp_dir();
        dir.push(format!("bloomery-stamp-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("1.20.6")).unwrap();
        fs::create_dir_all(dir.join("1.21.1")).unwrap();

        let stamps = path_stamps(vec![
            dir.to_string_lossy().to_string(),
            "/nonexistent/bloomery".to_string(),
        ]);

        assert!(stamps[0].exists);
        assert_eq!(stamps[0].entries, 2);
        assert!(!stamps[1].exists);
        assert_eq!(stamps[1].entries, 0);
        let _ = fs::remove_dir_all(dir);
    }
}
