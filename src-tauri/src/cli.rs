use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

/// 运行中的 CLI 子进程，按调用 id 取消
#[derive(Default)]
pub struct CliProcesses(pub Mutex<HashMap<String, Child>>);

#[derive(Deserialize)]
pub struct CliRequest {
    /// 调用方生成的 id，用于路由 stderr 事件与取消
    pub id: String,
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
}

#[derive(Serialize)]
pub struct CliOutcome {
    pub code: i32,
    pub stdout: String,
}

#[derive(Clone, Serialize)]
struct CliStderrLine {
    id: String,
    line: String,
}

/// 轮询间隔：等待期间保持可取消
const POLL: Duration = Duration::from_millis(40);

#[tauri::command]
pub async fn cli_run(app: AppHandle, request: CliRequest) -> Result<CliOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || run_blocking(app, request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn cli_kill(state: State<'_, CliProcesses>, id: String) -> Result<(), String> {
    let mut processes = state.0.lock().map_err(|_| "状态锁失败".to_string())?;
    match processes.get_mut(&id) {
        Some(child) => child.kill().map_err(|error| error.to_string()),
        None => Ok(()),
    }
}

fn run_blocking(app: AppHandle, request: CliRequest) -> Result<CliOutcome, String> {
    // 统一构造：Windows 下按 PATHEXT 解析、批处理过 cmd /C、不弹控制台
    let mut command = crate::program::build_command(&request.program, &request.args);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = request.cwd.as_deref() {
        command.current_dir(cwd);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 {}：{error}", request.program))?;
    let id = request.id.clone();

    let stdout = child.stdout.take().ok_or("stdout 未捕获")?;
    let stderr = child.stderr.take().ok_or("stderr 未捕获")?;

    // stdout 独立线程读走：逐行转发（设备码一类的 NDJSON 事件），同时累积成完整输出
    let stdout_emitter = app.clone();
    let stdout_id = id.clone();
    let stdout_reader = std::thread::spawn(move || {
        let mut buffer = String::new();
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = stdout_emitter.emit(
                "cli://stdout",
                CliStderrLine {
                    id: stdout_id.clone(),
                    line: line.clone(),
                },
            );
            buffer.push_str(&line);
            buffer.push('\n');
        }
        buffer
    });

    // stderr 逐行转发给前端：进度 ndjson 与人类提示都在这一路
    let emitter = app.clone();
    let line_id = id.clone();
    let stderr_reader = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = emitter.emit("cli://stderr", CliStderrLine { id: line_id.clone(), line });
        }
    });

    app.state::<CliProcesses>()
        .0
        .lock()
        .map_err(|_| "状态锁失败".to_string())?
        .insert(id.clone(), child);

    let code = loop {
        {
            let cli_state = app.state::<CliProcesses>();
            let mut processes = cli_state.0.lock().map_err(|_| "状态锁失败".to_string())?;
            match processes.get_mut(&id) {
                Some(process) => match process.try_wait() {
                    Ok(Some(status)) => {
                        processes.remove(&id);
                        break status.code().unwrap_or(-1);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        processes.remove(&id);
                        return Err(error.to_string());
                    }
                },
                None => break -1,
            }
        }
        std::thread::sleep(POLL);
    };

    let stdout = stdout_reader.join().unwrap_or_default();
    let _ = stderr_reader.join();

    Ok(CliOutcome { code, stdout })
}
