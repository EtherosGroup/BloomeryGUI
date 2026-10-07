use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use serde::{Deserialize, Serialize};

/// 窗口已出现的日志标志：GLFW 建好窗口、渲染线程起来后才会有这一行
const WINDOW_MARKERS: [&str; 2] = ["backend library: lwjgl", "sound engine started"];

/// 单次最多往回看这么多字节，日志只增时不必读整份
const TAIL_BYTES: u64 = 128 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStatus {
    /// 进程是否存活，拿不到 pid 时为 null
    pub alive: Option<bool>,
    /// 窗口是否已出现
    pub window_ready: bool,
    /// 判定依据，界面直接展示
    pub evidence: String,
}

/// 一个要看的日志：只看启动时记下的偏移之后的内容
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLog {
    pub path: String,
    /// 启动时的文件大小
    pub since: u64,
}

/// Linux：/proc 里还在且不是僵尸
#[cfg(target_os = "linux")]
fn process_alive(pid: u32) -> Option<bool> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    // 状态字段在最后一个 ')' 之后
    let state = stat.rsplit(')').next()?.trim().chars().next()?;
    Some(state != 'Z' && state != 'X')
}

/// Windows：同步权限的句柄等到超时即为存活
#[cfg(windows)]
fn process_alive(pid: u32) -> Option<bool> {
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
        fn WaitForSingleObject(handle: isize, milliseconds: u32) -> u32;
        fn CloseHandle(handle: isize) -> i32;
    }

    /// 只要同步权限，够 wait 用
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const WAIT_TIMEOUT: u32 = 0x0000_0102;

    unsafe {
        let handle = OpenProcess(SYNCHRONIZE, 0, pid);
        // 打不开按已退出处理：游戏由本进程链拉起
        if handle == 0 {
            return Some(false);
        }
        let state = WaitForSingleObject(handle, 0);
        CloseHandle(handle);
        Some(state == WAIT_TIMEOUT)
    }
}

/// 其它平台：问一下系统命令，取不到就当未知
#[cfg(all(not(windows), not(target_os = "linux")))]
fn process_alive(pid: u32) -> Option<bool> {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .output()
        .ok()
        .map(|output| output.status.success())
}

/// Windows 下按窗口类找游戏窗口，类名由 GLFW/LWJGL 注册，命中还要求 pid 对得上
#[cfg(windows)]
fn window_by_class(classes: &[&str], pid: Option<u32>) -> Option<String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(callback: extern "system" fn(isize, isize) -> i32, param: isize) -> i32;
        fn GetClassNameW(window: isize, buffer: *mut u16, max: i32) -> i32;
        fn GetWindowTextW(window: isize, buffer: *mut u16, max: i32) -> i32;
        fn IsWindowVisible(window: isize) -> i32;
        fn GetWindowThreadProcessId(window: isize, process: *mut u32) -> u32;
    }

    /// 枚举回调是 fn item，捕获不了外部变量，类名列表与结果一并由 param 传入
    struct Context<'a> {
        classes: &'a [&'a str],
        pid: Option<u32>,
        title: String,
    }

    extern "system" fn visit(window: isize, param: isize) -> i32 {
        unsafe {
            if IsWindowVisible(window) == 0 {
                return 1;
            }
            let context = &mut *(param as *mut Context);
            // 认 pid 归属：其它实例、其它启动器的同款窗口不算本次启动
            if let Some(wanted) = context.pid {
                let mut owner: u32 = 0;
                GetWindowThreadProcessId(window, &mut owner);
                if owner != wanted {
                    return 1;
                }
            }
            let mut class_buffer = [0u16; 256];
            let length = GetClassNameW(window, class_buffer.as_mut_ptr(), 256);
            if length <= 0 {
                return 1;
            }
            let class = OsString::from_wide(&class_buffer[..length as usize])
                .to_string_lossy()
                .to_string();
            let matched = context
                .classes
                .iter()
                .any(|want| class.eq_ignore_ascii_case(want));
            if !matched {
                return 1;
            }
            let mut title_buffer = [0u16; 512];
            let title_length = GetWindowTextW(window, title_buffer.as_mut_ptr(), 512);
            context.title = if title_length > 0 {
                OsString::from_wide(&title_buffer[..title_length as usize])
                    .to_string_lossy()
                    .to_string()
            } else {
                class
            };
            0
        }
    }

    let mut context = Context {
        classes,
        pid,
        title: String::new(),
    };
    unsafe {
        EnumWindows(visit, &mut context as *mut Context as isize);
    }
    if context.title.is_empty() {
        return None;
    }
    Some(context.title)
}

/// 扫日志尾部找窗口标志行，只认 since 之后的内容，返回命中的那一行
fn marker_in_log(path: &str, since: u64) -> Option<String> {
    let mut file = fs::File::open(Path::new(path)).ok()?;
    let size = file.metadata().ok()?.len();
    // 水位：截断或轮转后整份算新内容
    let start = if size < since { 0 } else { since };
    let from = start.max(size.saturating_sub(TAIL_BYTES));

    file.seek(SeekFrom::Start(from)).ok()?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).ok()?;
    // 起点可能落在多字节字符中间，有损转换兜住
    let text = String::from_utf8_lossy(&buffer);

    for line in text.lines().rev() {
        let lower = line.to_lowercase();
        if WINDOW_MARKERS.iter().any(|marker| lower.contains(marker)) {
            return Some(line.trim().to_string());
        }
    }
    None
}

/// 记下日志当前大小：轮询只认这个偏移之后的内容，上一次会话的标志行不算数
#[tauri::command]
pub fn log_sizes(paths: Vec<String>) -> Vec<u64> {
    paths
        .iter()
        .map(|path| fs::metadata(path).map(|meta| meta.len()).unwrap_or(0))
        .collect()
}

/// 游戏状态：进程存活 + 窗口是否已出现
///
/// Wayland 下没有全局窗口列表，X11 枚举也看不到原生 Wayland 窗口，所以窗口判定以游戏日志为准；
/// Windows 上再补一条按窗口类枚举的路，命中还要求 pid 与本次启动一致
#[tauri::command]
pub fn game_status(pid: Option<u32>, logs: Option<Vec<GameLog>>) -> GameStatus {
    let alive = pid.map(|value| process_alive(value).unwrap_or(false));

    // 依次看多个日志：CLI 捕获的游戏 stdout 与游戏自己的 latest.log，任一带标志行即算窗口出现
    if let Some(entries) = logs.as_deref() {
        for entry in entries {
            if let Some(line) = marker_in_log(&entry.path, entry.since) {
                let name = Path::new(&entry.path)
                    .file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_else(|| entry.path.clone());
                return GameStatus {
                    alive,
                    window_ready: true,
                    evidence: format!("{name} · {line}"),
                };
            }
        }
    }

    #[cfg(windows)]
    if let Some(title) = window_by_class(&["LWJGL", "GLFW30", "GLFW"], pid) {
        return GameStatus {
            alive,
            window_ready: true,
            evidence: format!("窗口 {title}"),
        };
    }

    let evidence = match alive {
        Some(false) => "进程已退出，日志里没有窗口标志行".to_string(),
        _ => "日志里还没有窗口标志行".to_string(),
    };
    GameStatus {
        alive,
        window_ready: false,
        evidence,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// 每个用例用独立文件名：并行执行时共用同一路径会互相覆盖
    fn write_log(name: &str, lines: &str) -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("bloomery-log-{}-{}.log", name, std::process::id()));
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(lines.as_bytes()).unwrap();
        path
    }

    fn log_of(path: &Path, since: u64) -> GameLog {
        GameLog {
            path: path.to_string_lossy().to_string(),
            since,
        }
    }

    #[test]
    fn finds_window_marker() {
        let path = write_log(
            "marker",
            "[17:28:04] [Render thread/INFO]: Setting user: XiangYuanHuLian\n\
             [17:28:04] [Render thread/INFO]: Backend library: LWJGL version 3.3.3-snapshot\n",
        );
        let status = game_status(None, Some(vec![log_of(&path, 0)]));
        assert!(status.window_ready);
        assert!(status.evidence.contains("Backend library"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn finds_marker_in_second_log() {
        let first = write_log("empty", "[17:28:00] [main/INFO]: Loading Minecraft\n");
        let second = write_log(
            "second",
            "[17:28:04] [Render thread/INFO]: Backend library: LWJGL version 3.3.3-snapshot\n",
        );
        let status = game_status(None, Some(vec![log_of(&first, 0), log_of(&second, 0)]));
        assert!(status.window_ready);
        assert!(status.evidence.contains("Backend library"));
        let _ = fs::remove_file(first);
        let _ = fs::remove_file(second);
    }

    #[test]
    fn no_marker_before_window() {
        let path = write_log(
            "before",
            "[17:28:00] [main/INFO]: Loading Minecraft 1.20.1\n",
        );
        let status = game_status(None, Some(vec![log_of(&path, 0)]));
        assert!(!status.window_ready);
        assert!(status.evidence.contains("还没有窗口标志行"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn missing_log_is_not_ready() {
        let status = game_status(
            Some(u32::MAX),
            Some(vec![log_of(Path::new("/nonexistent/game.log"), 0)]),
        );
        assert!(!status.window_ready);
        assert_eq!(status.alive, Some(false));
    }

    /// 上一次会话的标志行留在日志里：偏移之后没有新内容就不算窗口出现
    #[test]
    fn marker_before_the_mark_is_ignored() {
        let path = write_log(
            "since-old",
            "[18:48:17] [Render thread/INFO]: Sound engine started\n",
        );
        let size = fs::metadata(&path).unwrap().len();

        let stale = game_status(None, Some(vec![log_of(&path, size)]));
        assert!(!stale.window_ready);

        let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(b"[11:42:23] [Render thread/INFO]: Sound engine started\n")
            .unwrap();

        let fresh = game_status(None, Some(vec![log_of(&path, size)]));
        assert!(fresh.window_ready);
        assert!(fresh.evidence.contains("11:42:23"));
        let _ = fs::remove_file(path);
    }

    /// 文件被截断或轮转：偏移大于当前大小，整份都算新内容
    #[test]
    fn truncated_log_counts_as_new() {
        let path = write_log(
            "truncated",
            "[11:42:23] [Render thread/INFO]: Backend library: LWJGL version 3.3.3\n",
        );

        let status = game_status(None, Some(vec![log_of(&path, 4096)]));
        assert!(status.window_ready);
        let _ = fs::remove_file(path);
    }

    /// 截断点落在多字节字符中间时不 panic
    #[test]
    fn cut_inside_a_multibyte_character_is_safe() {
        let mut lines = "a".repeat(100);
        lines.push('中');
        // 让 size - TAIL_BYTES 落在 '中' 的第二个字节上
        lines.push_str(&"b".repeat(TAIL_BYTES as usize + 101 - 103));
        let path = write_log("multibyte", &lines);

        let status = game_status(None, Some(vec![log_of(&path, 0)]));
        assert!(!status.window_ready);
        let _ = fs::remove_file(path);
    }
}
