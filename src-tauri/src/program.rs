use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use serde::Serialize;

/// Windows 下不弹出控制台窗口
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 去重后追加
fn push_unique(dirs: &mut Vec<PathBuf>, path: PathBuf) {
    if !dirs.contains(&path) {
        dirs.push(path);
    }
}

/// nvm 的 node 目录，版本号大的在前
fn node_directories(root: &Path) -> Vec<PathBuf> {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    let mut rows: Vec<(Vec<u32>, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let bin = entry.path().join("bin");
        if !bin.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let key: Vec<u32> = name
            .trim_start_matches('v')
            .split('.')
            .map(|part| part.parse::<u32>().unwrap_or(0))
            .collect();
        rows.push((key, bin));
    }
    rows.sort_by(|left, right| right.0.cmp(&left.0));
    rows.into_iter().map(|(_, bin)| bin).collect()
}

/// PATH 之后补进来的目录：桌面会话的环境里没有 nvm 与 pnpm 的 bin
fn extra_directories(
    home: Option<&Path>,
    nvm_dir: Option<&Path>,
    pnpm_home: Option<&Path>,
) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    let nvm_root = nvm_dir
        .map(|path| path.to_path_buf())
        .or_else(|| home.map(|path| path.join(".nvm")));
    if let Some(root) = nvm_root {
        for bin in node_directories(&root.join("versions").join("node")) {
            push_unique(&mut dirs, bin);
        }
    }

    if let Some(root) = pnpm_home {
        push_unique(&mut dirs, root.join("bin"));
        push_unique(&mut dirs, root.to_path_buf());
    }

    let mut fixed: Vec<PathBuf> = Vec::new();
    if let Some(home) = home {
        fixed.push(home.join(".local").join("share").join("pnpm").join("bin"));
        fixed.push(home.join(".local").join("share").join("pnpm"));
        fixed.push(home.join(".local").join("bin"));
        fixed.push(home.join("bin"));
        fixed.push(home.join(".npm-global").join("bin"));
        fixed.push(home.join(".bun").join("bin"));
        fixed.push(home.join(".volta").join("bin"));
    }

    #[cfg(windows)]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            fixed.push(PathBuf::from(appdata).join("npm"));
        }
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            fixed.push(PathBuf::from(program_files).join("nodejs"));
        }
    }
    #[cfg(not(windows))]
    fixed.extend(
        [
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/snap/bin",
            "/opt/homebrew/bin",
        ]
        .into_iter()
        .map(PathBuf::from),
    );

    for path in fixed {
        if path.is_dir() {
            push_unique(&mut dirs, path);
        }
    }
    dirs
}

/// 搜索目录：PATH 在前，补进来的在后
fn search_directories() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    #[cfg(windows)]
    let home = home.or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from));

    let nvm = std::env::var_os("NVM_DIR").map(PathBuf::from);
    let pnpm = std::env::var_os("PNPM_HOME").map(PathBuf::from);
    let path = std::env::var_os("PATH");

    search_directories_of(
        path.as_deref(),
        home.as_deref(),
        nvm.as_deref(),
        pnpm.as_deref(),
    )
}

/// 桌面会话启动的 GUI 拿不到 shell 的 PATH，nvm 与 pnpm 的 bin 由 home 推出来
fn search_directories_of(
    path: Option<&OsStr>,
    home: Option<&Path>,
    nvm_dir: Option<&Path>,
    pnpm_home: Option<&Path>,
) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::split_paths(path.unwrap_or_default())
        .filter(|entry| !entry.as_os_str().is_empty())
        .collect();

    for entry in extra_directories(home, nvm_dir, pnpm_home) {
        push_unique(&mut dirs, entry);
    }
    dirs
}

/// Unix 看执行位
#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.is_file()
        && path
            .metadata()
            .map(|meta| meta.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

/// 绝对路径或带分隔符的原样判断，其余按目录列表找
fn resolve_program(program: &str, directories: &[PathBuf]) -> Option<PathBuf> {
    let as_path = Path::new(program);
    if as_path.is_absolute() || program.contains('\\') || program.contains('/') {
        return is_executable(as_path).then(|| as_path.to_path_buf());
    }

    // Windows 下 Rust 自己只认 .exe，按 PATHEXT 补后缀
    let extensions: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
            .split(';')
            .filter(|item| !item.is_empty())
            .map(|item| item.to_ascii_lowercase())
            .collect()
    } else {
        vec![String::new()]
    };

    for dir in directories {
        for extension in &extensions {
            let candidate = dir.join(format!("{program}{extension}"));
            if is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

/// 子进程的 PATH：npm 与 pnpm 的 shim 脚本靠它找 node
fn apply_path(command: &mut Command, directories: &[PathBuf]) {
    if let Ok(path) = std::env::join_paths(directories) {
        command.env("PATH", path);
    }
}

/// 构造子进程：批处理包装走 cmd /C，Windows 下统一不弹控制台
pub fn build_command(program: &str, args: &[String]) -> Command {
    let directories = search_directories();
    let resolved = resolve_program(program, &directories);

    #[cfg(windows)]
    {
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
        apply_path(&mut command, &directories);
        return command;
    }

    #[cfg(not(windows))]
    {
        let mut command = match resolved {
            Some(path) => Command::new(path),
            // 解析不到就交给系统报错，错误原样带回前端
            None => Command::new(program),
        };
        command.args(args);
        apply_path(&mut command, &directories);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::fs;

    /// 每个用例用独立目录：并行执行时共用同一路径会互相覆盖
    fn temp_dir(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("bloomery-tool-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_program(dir: &Path, name: &str) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    }

    #[test]
    fn resolve_takes_the_directory_that_has_it() {
        let first = temp_dir("resolve-first");
        let second = temp_dir("resolve-second");
        let found = write_program(&second, "node");
        let dirs = vec![first.clone(), second.clone()];

        assert_eq!(resolve_program("node", &dirs), Some(found));
        let _ = fs::remove_dir_all(first);
        let _ = fs::remove_dir_all(second);
    }

    #[test]
    fn resolve_prefers_the_earlier_directory() {
        let first = temp_dir("order-first");
        let second = temp_dir("order-second");
        let wanted = write_program(&first, "bloomery");
        write_program(&second, "bloomery");
        let dirs = vec![first.clone(), second.clone()];

        assert_eq!(resolve_program("bloomery", &dirs), Some(wanted));
        let _ = fs::remove_dir_all(first);
        let _ = fs::remove_dir_all(second);
    }

    #[test]
    fn resolve_keeps_paths_with_separators() {
        let dir = temp_dir("resolve-path");
        let program = write_program(&dir, "bloomery");

        assert_eq!(
            resolve_program(program.to_string_lossy().as_ref(), &[]),
            Some(program)
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn resolve_skips_files_without_execute_bit() {
        let dir = temp_dir("resolve-mode");
        fs::write(dir.join("bloomery"), "#!/bin/sh\n").unwrap();

        assert_eq!(resolve_program("bloomery", &[dir.clone()]), None);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn extra_directories_puts_newest_node_first() {
        let home = temp_dir("extra-nvm");
        write_program(
            &home
                .join(".nvm")
                .join("versions")
                .join("node")
                .join("v20.11.0")
                .join("bin"),
            "node",
        );
        write_program(
            &home
                .join(".nvm")
                .join("versions")
                .join("node")
                .join("v24.20.0")
                .join("bin"),
            "node",
        );

        let dirs = extra_directories(Some(&home), None, None);
        let older = dirs
            .iter()
            .position(|path| path.ends_with("v20.11.0/bin"))
            .unwrap();
        let newer = dirs
            .iter()
            .position(|path| path.ends_with("v24.20.0/bin"))
            .unwrap();

        assert!(newer < older);
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn extra_directories_honours_pnpm_home() {
        let home = temp_dir("extra-pnpm");
        let pnpm = home.join("pnpm-home");
        write_program(&pnpm.join("bin"), "bloomery");

        let dirs = extra_directories(Some(&home), None, Some(&pnpm));

        assert_eq!(dirs.first(), Some(&pnpm.join("bin")));
        let _ = fs::remove_dir_all(home);
    }

    /// 桌面会话的 PATH 里没有 nvm 的 bin，靠 home 推出来
    #[test]
    fn search_directories_appends_nvm_bin() {
        let home = temp_dir("search-nvm");
        let bin = home
            .join(".nvm")
            .join("versions")
            .join("node")
            .join("v24.20.0")
            .join("bin");
        write_program(&bin, "node");

        let dirs = search_directories_of(Some(OsStr::new("/usr/bin")), Some(&home), None, None);

        assert_eq!(dirs.first(), Some(&PathBuf::from("/usr/bin")));
        assert!(dirs.iter().any(|entry| entry.ends_with("v24.20.0/bin")));

        // Windows 上按 PATHEXT 找 .exe，这里写的假程序没有后缀
        #[cfg(unix)]
        assert_eq!(resolve_program("node", &dirs), Some(bin.join("node")));
        let _ = fs::remove_dir_all(home);
    }
}
