mod background;
mod cli;
mod diag;
mod files;
mod game;
mod program;
mod system;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};

/// 主窗口标签，与 tauri.conf.json 的窗口配置一致
const MAIN: &str = "main";

/// 托盘是否建成：没托盘时不能把窗口藏起来，否则叫不回来
static TRAY_READY: AtomicBool = AtomicBool::new(false);

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 显示并聚焦主窗口：隐藏到托盘后从菜单或双击图标唤回
fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 系统托盘：菜单「显示主界面 / 启动游戏 / 退出」
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主界面", true, None::<&str>)?;
    let launch = MenuItem::with_id(app, "launch", "启动游戏", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &launch, &quit])?;

    let mut builder = TrayIconBuilder::with_id("bloomery")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "launch" => {
                show_main(app);
                // 隐藏的只是窗口，webview 还在；App.vue 收到后走一次启动流程
                let _ = app.emit_to(MAIN, "tray://launch", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 双击图标回到主界面；菜单走右键
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    // 图标沿用打包用的 app 图标
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(cli::CliProcesses::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            cli::cli_run,
            cli::cli_kill,
            system::open_path,
            background::save_background,
            background::remove_background,
            background::background_path,
            files::read_text_file,
            files::ensure_directory,
            files::path_stamps,
            game::game_status,
            game::log_sizes,
            program::run_program,
            diag::append_diag,
            diag::diag_info,
            program::system_facts,
            program::download_file
        ])
        .setup(|app| {
            // 托盘建不起来（例如缺 appindicator）不该拖垮整个应用；
            // 但既然没有可唤回的入口，关窗就得按默认退出走
            match build_tray(app.handle()) {
                Ok(()) => TRAY_READY.store(true, Ordering::Relaxed),
                Err(error) => eprintln!("托盘创建失败：{error}"),
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关窗口只收到托盘：webview 保持存活，托盘菜单随时能唤回
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !TRAY_READY.load(Ordering::Relaxed) {
                    return;
                }
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        // macOS 点 Dock 图标时把隐藏的窗口叫回来
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } = event
        {
            if !has_visible_windows {
                show_main(app);
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app, event);
        }
    });
}
