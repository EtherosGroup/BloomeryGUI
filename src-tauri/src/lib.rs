mod background;
mod cli;
mod diag;
mod files;
mod game;
mod program;
mod system;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            game::game_status,
            game::log_sizes,
            program::run_program,
            diag::append_diag,
            diag::diag_info,
            program::system_facts,
            program::download_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
