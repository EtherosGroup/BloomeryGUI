use std::process::Command;

#[cfg(windows)]
use std::path::{Path, PathBuf};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use serde::Serialize;

/// Windows 下不弹出控制台窗口
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Windows 下按 PATHEXT 找可执行文件，Rust 自己只认 .exe
#[cfg(windows)]
fn resolve_windows(program: &str) -> Option<PathBuf> {
    let as_path = Path::new(program);
    if as_path.is_absolute() || program.contains('\\') || program.contains('/') {
        return as_path.is_file().then(|| as_path.to_path_buf());
    }

    let extensions = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    for dir in std::env::split_paths(&std::env::var("PATH").unwrap_or_default()) {
        for extension in extensions.split(';').filter(|item| !item.is_empty()) {
            let candidate = dir.join(format!("{program}{}", extension.to_ascii_lowercase()));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// 构造子进程：批处理包装走 cmd /C，Windows 下统一不弹控制台
pub fn build_command(program: &str, args: &[String]) -> Command {
    #[cfg(windows)]
    {
        let resolved = resolve_windows(program);
        let is_batch = resolved
            .as_ref()
            .and_then(|path| path.extension())
            .and_then(|extension| extension.to_str())
            .map(|extension| {
                let lower = extension.to_ascii_lowercase();
                lower == "cmd" || lower == "bat"
            })
            .unwrap_or(false);

        let mut command = match (resolved, is_batch) {
            (Some(path), true) => {
                let mut shell = Command::new("cmd");
                shell.arg("/C").arg(path);
                shell
            }
            (Some(path), false) => Command::new(path),
            // 解析不到就交给系统报错，错误原样带回前端
            (None, _) => Command::new(program),
        };
        command.args(args);
        command.creation_flags(CREATE_NO_WINDOW);
        return command;
    }

    #[cfg(not(windows))]
    {
        let mut command = Command::new(program);
        command.args(args);
        command
    }
}

/// 单次执行允许的输出上限
const MAX_OUTPUT: usize = 64 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramOutcome {
    /// 进程退出码，被信号杀死时为 null
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    /// 是否根本没起来（找不到程序等）
    pub spawned: bool,
}

fn clip(bytes: &[u8]) -> String {
    let end = bytes.len().min(MAX_OUTPUT);
    String::from_utf8_lossy(&bytes[..end]).to_string()
}

/// 跑任意程序并取回输出，用于探测 node / bloomery / nvm / pnpm 等环境事实
#[tauri::command]
pub fn run_program(program: String, args: Vec<String>) -> Result<ProgramOutcome, String> {
    let output = match build_command(&program, &args).output() {
        Ok(value) => value,
        Err(error) => {
            // 程序不存在是正常探测结果，不算命令失败
            return Ok(ProgramOutcome {
                code: None,
                stdout: String::new(),
                stderr: error.to_string(),
                spawned: false,
            });
        }
    };

    Ok(ProgramOutcome {
        code: output.status.code(),
        stdout: clip(&output.stdout),
        stderr: clip(&output.stderr),
        spawned: true,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFacts {
    /// windows / linux / macos
    pub platform: String,
    /// x86_64 / aarch64 / x86 / arm
    pub arch: String,
    /// 下载目录，取不到为空串
    pub downloads: String,
}

/// 运行平台事实，供前端分支 Windows / Linux 行为并选择安装包
#[tauri::command]
pub fn system_facts(app: tauri::AppHandle) -> SystemFacts {
    use tauri::Manager;

    let downloads = app
        .path()
        .download_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();

    SystemFacts {
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        downloads,
    }
}

/// 经系统 curl 下载文件，返回落盘路径
#[tauri::command]
pub fn download_file(url: String, target: String) -> Result<String, String> {
    let outcome = build_command(
        "curl",
        &[
            "-L".to_string(),
            "--fail".to_string(),
            "--silent".to_string(),
            "--show-error".to_string(),
            "-o".to_string(),
            target.clone(),
            url.clone(),
        ],
    )
    .output()
    .map_err(|error| error.to_string())?;

    if !outcome.status.success() {
        let detail = String::from_utf8_lossy(&outcome.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            format!("下载失败，退出码 {:?}", outcome.status.code())
        } else {
            detail
        });
    }

    Ok(target)
}
