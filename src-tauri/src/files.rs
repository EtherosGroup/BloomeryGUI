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
