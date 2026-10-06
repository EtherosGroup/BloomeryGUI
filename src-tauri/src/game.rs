use std::fs;
use std::path::Path;

use serde::Serialize;

/// 窗口已出现的日志标志：GLFW 建好窗口、渲染线程起来后才会有这一行
const WINDOW_MARKERS: [&str; 2] = ["backend library: lwjgl", "sound engine started"];

/// 只扫日志尾部，避免读整份日志
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

/// Linux：/proc 里还在且不是僵尸
#[cfg(target_os = "linux")]
fn process_alive(pid: u32) -> Option<bool> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    // 状态字段在最后一个 ')' 之后
    let state = stat.rsplit(')').next()?.trim().chars().next()?;
    Some(state != 'Z' && state != 'X')
}

/// 其它平台：问一下系统命令，取不到就当未知
#[cfg(not(target_os = "linux"))]
fn process_alive(pid: u32) -> Option<bool> {
    // 走统一构造：Windows 下不弹控制台（此处每 1.5 秒被轮询一次）
    #[cfg(windows)]
    let output = crate::program::build_command(
        "tasklist",
        &["/FI".to_string(), format!("PID eq {pid}"), "/NH".to_string()],
    )
    .output()
    .ok()?;
    #[cfg(not(windows))]
    let output = std::process::Command::new("kill").args(["-0", &pid.to_string()]).output().ok()?;
    Some(output.status.success())
}

/// Windows 下按窗口类找游戏窗口，类名由 GLFW/LWJGL 注册
#[cfg(windows)]
fn window_by_class(classes: &[&str], bring_to_front: bool) -> Option<String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(callback: extern "system" fn(isize, isize) -> i32, param: isize) -> i32;
        fn GetClassNameW(window: isize, buffer: *mut u16, max: i32) -> i32;
        fn GetWindowTextW(window: isize, buffer: *mut u16, max: i32) -> i32;
        fn IsWindowVisible(window: isize) -> i32;
        fn SetForegroundWindow(window: isize) -> i32;
        fn ShowWindow(window: isize, command: i32) -> i32;
    }

    /// SW_RESTORE：还原被最小化的窗口
    const SW_RESTORE: i32 = 9;

    struct Found {
        title: String,
        /// 命中窗口的句柄，只有需要带到前台时才读
        #[allow(dead_code)]
        window: isize,
    }

    /// 枚举回调是 fn item，捕获不了外部变量，类名列表与结果一并由 param 传入
    struct Context<'a> {
        classes: &'a [&'a str],
        bring_to_front: bool,
        found: Found,
    }

    extern "system" fn visit(window: isize, param: isize) -> i32 {
        unsafe {
            if IsWindowVisible(window) == 0 {
                return 1;
            }
            let context = &mut *(param as *mut Context);
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
            let title = if title_length > 0 {
                OsString::from_wide(&title_buffer[..title_length as usize])
                    .to_string_lossy()
                    .to_string()
            } else {
                class
            };
            context.found.title = title;
            context.found.window = window;
            0
        }
    }

    let mut context = Context {
        classes,
        bring_to_front,
        found: Found {
            title: String::new(),
            window: 0,
        },
    };
    unsafe {
        EnumWindows(visit, &mut context as *mut Context as isize);
    }
    if context.found.title.is_empty() {
        return None;
    }
    // 窗口已出现却落在别的窗口后面：游戏建窗往往在启动器退出之后，
    // 此时它已不被允许自行抢前台，由仍在前台的界面代劳
    if bring_to_front {
        unsafe {
            ShowWindow(context.found.window, SW_RESTORE);
            SetForegroundWindow(context.found.window);
        }
    }
    Some(context.found.title)
}

/// 扫日志尾部找窗口标志行，返回命中的那一行
fn marker_in_log(path: &str) -> Option<String> {
    let file = fs::File::open(Path::new(path)).ok()?;
    let size = file.metadata().ok()?.len();
    let text = fs::read_to_string(path).ok()?;
    let tail: String = if size > TAIL_BYTES {
        let start = text.len().saturating_sub(TAIL_BYTES as usize);
        text[start..].to_string()
    } else {
        text
    };
    for line in tail.lines().rev() {
        let lower = line.to_lowercase();
        if WINDOW_MARKERS.iter().any(|marker| lower.contains(marker)) {
            return Some(line.trim().to_string());
        }
    }
    None
}

/// 游戏状态：进程存活 + 窗口是否已出现
///
/// Wayland 下没有全局窗口列表，X11 枚举也看不到原生 Wayland 窗口，所以窗口判定以游戏日志为准；
/// Windows 上再补一条按窗口类枚举的路，与 PCL 的做法一致
#[tauri::command]
pub fn game_status(
    pid: Option<u32>,
    logs: Option<Vec<String>>,
    focus: Option<bool>,
) -> GameStatus {
    let alive = pid.map(|value| process_alive(value).unwrap_or(false));

    // 依次看多个日志：CLI 捕获的 stdout 与游戏自己的 latest.log，任一带标志行即算窗口出现
    if let Some(paths) = logs.as_deref() {
        for path in paths {
            if let Some(line) = marker_in_log(path) {
                let name = Path::new(path)
                    .file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_else(|| path.clone());
                return GameStatus {
                    alive,
                    window_ready: true,
                    evidence: format!("{name} · {line}"),
                };
            }
        }
    }

    #[cfg(windows)]
    if let Some(title) = window_by_class(&["LWJGL", "GLFW30", "GLFW"], focus.unwrap_or(false)) {
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

    #[test]
    fn finds_window_marker() {
        let path = write_log(
            "marker",
            "[17:28:04] [Render thread/INFO]: Setting user: XiangYuanHuLian\n\
             [17:28:04] [Render thread/INFO]: Backend library: LWJGL version 3.3.3-snapshot\n",
        );
        let status = game_status(None, Some(vec![path.to_string_lossy().to_string()]), None);
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
        let status = game_status(
            None,
            Some(vec![
                first.to_string_lossy().to_string(),
                second.to_string_lossy().to_string(),
            ]),
            None,
        );
        assert!(status.window_ready);
        assert!(status.evidence.contains("Backend library"));
        let _ = fs::remove_file(first);
        let _ = fs::remove_file(second);
    }

    #[test]
    fn no_marker_before_window() {
        let path = write_log("before", "[17:28:00] [main/INFO]: Loading Minecraft 1.20.1\n");
        let status = game_status(None, Some(vec![path.to_string_lossy().to_string()]), None);
        assert!(!status.window_ready);
        assert!(status.evidence.contains("还没有窗口标志行"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn missing_log_is_not_ready() {
        let status = game_status(Some(u32::MAX), Some(vec!["/nonexistent/game.log".to_string()]), None);
        assert!(!status.window_ready);
        assert_eq!(status.alive, Some(false));
    }
}
