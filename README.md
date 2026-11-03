# BloomeryGUI

Bloomery 命令行启动器的图形界面：用 Tauri v2 + Vue 3 包一层桌面壳，把 CLI 的账号、下载队列、
MOD、游戏启动等能力做成可点的界面。Rust 侧只负责起进程、转发事件与少量本地文件操作，
业务逻辑仍由 Bloomery CLI 承担。

## 技术栈

- 桌面壳：Tauri 2（Rust 2021 edition）+ `tauri-plugin-opener`，窗口资源走 `protocol-asset`
- 前端：Vue 3 + TypeScript，构建用 Vite
- 状态：Pinia（配 `pinia-plugin-persistedstate`），路由用 vue-router
- UI 依赖：`@phosphor-icons/vue`、`nprogress`、`vue3-toastify`
- 格式化：oxfmt（4 空格、单引号、无分号、行宽 100）

## 依赖

- Node.js >= 22
- pnpm
- Rust 工具链（stable），以及 Tauri 各平台系统依赖：
    - Windows：WebView2 运行时（Win10/11 自带）、MSVC 生成工具
    - Linux（Debian / Ubuntu）：`libwebkit2gtk-4.1-dev`、`build-essential`、`curl`、`wget`、
      `file`、`libxdo-dev`、`libssl-dev`、`libayatana-appindicator3-dev`、`librsvg2-dev`
    - macOS：Xcode Command Line Tools

## 开发

```bash
pnpm install
pnpm dev          # 只起前端，端口 1420（predev 会先清掉占用端口的进程）
pnpm tauri dev    # 起完整桌面应用（devUrl 固定 http://localhost:1420）
```

## 构建

`src-tauri/tauri.conf.json` 里 `bundle.targets` 是 `all`，本地直接 `pnpm tauri build` 会按当前
平台打全部可打的包；CI 则用 `--bundles` 显式限定，避免产出用不上的东西。

### Windows

```bash
pnpm tauri build --bundles msi,nsis
```

产物在 `src-tauri/target/release/bundle/{msi,nsis}/`；便携版可执行文件是
`src-tauri/target/release/bloomery-gui.exe`。

### Linux

先装上面列的 apt 依赖，再：

```bash
pnpm tauri build --bundles deb
```

产物在 `src-tauri/target/release/bundle/deb/`。

### macOS

在 macOS 上执行。先补两个架构的 target，再打通用（universal）包：

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm tauri build --target universal-apple-darwin --bundles dmg
```

产物是同时含 `x86_64` 与 `arm64` 切片的通用二进制，`.app` 与 dmg 落在
`src-tauri/target/universal-apple-darwin/release/bundle/` 下（注意带 target 名，与单架构的
`target/release/bundle/` 不同）。`--bundles dmg` 只产出 dmg，需要 zip 时自行用
`ditto -c -k --keepParent` 打包 `.app`。

macOS 图标是 `src-tauri/icons/icon.icns`，由仓库里的几档 PNG 拼出；换图标后重跑
`pnpm run icons:icns` 再打包（`.icns` 不会自动跟着 PNG 更新）。工作流没有配置 Apple 签名证书，
产物是 ad-hoc 签名、未公证包，首次打开需右键「打开」；要正式分发需自行配置开发者证书与公证。
最低支持 macOS 10.15（`bundle.macOS.minimumSystemVersion`），Apple Silicon 需 11+。

运行前提：GUI 首次启动会探测 Node.js（>= 22）与 `bloomery` CLI（`npm install -g bloomery`）。
macOS 上装了 Homebrew 时可在配置页直接用它装 Node.js；没有 Homebrew 时配置页给出可复制的终端命令。

## 自检脚本

都不依赖 Rust 工具链，Node 直接跑：

| 命令                    | 作用                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| `pnpm run check:errors` | 用 fixtures 里的真实 CLI 输出，回归错误信封的解析与文案               |
| `pnpm run check:icons`  | 断言 `bundle.icon` 每项在磁盘存在且非空，并校验 `.icns` 结构（macOS）  |
| `pnpm run check:icns`   | 断言 `icon.icns` 与当前 PNG 一致（换图标后忘了重跑会失败）              |
| `pnpm run check:launch` | 回归启动阶段的步骤与说明文案                                          |
| `pnpm run check:spawns` | 断言起进程只有 `program.rs` 一个入口（Windows 需 `CREATE_NO_WINDOW`）  |
| `pnpm run icons:icns`   | 从 `src-tauri/icons/` 的 PNG 与仓库根 `app-icon.png` 重新生成 icns    |

`check:icons` 只看存在性与结构，真读图标的是各平台打包；透明度、尺寸合理性这类问题只有打包时
才会暴露。

## 发版

1. 升版本：`pnpm version <版本> --no-git-tag-version`，`scripts/sync-version.mjs` 会把版本号同步到
   `src-tauri/tauri.conf.json` 与 `src-tauri/Cargo.toml`
2. 提交后打 `v*` 标签推送，`.github/workflows/release.yml` 在 Windows / Linux / macOS 三个平台打包
3. Release 附件：`-windows-x64-en-US.msi`、`-windows-x64-zh-CN.msi`、`-windows-x64-setup.exe`、
   `-windows-x64-portable.zip`、`-linux-x64.deb`、`-macos-universal.dmg`、`-macos-universal.zip`
4. `workflow_dispatch` 走演练路径：同样打包冒烟，只上传 workflow artifact，不创建 Release

产物路径与文件名约定见 [docs/build-artifacts.md](docs/build-artifacts.md)；macOS 产物命名同样
待 CI 演练确认。macOS 包为 ad-hoc 签名、未公证，首次打开需右键「打开」。

## 目录结构

```
src/                  前端
  api/                调 Tauri 命令的薄封装
  components/         通用组件
  composables/        组合式逻辑
  router/             路由
  stores/             Pinia store
  types/              共享类型
  utils/              纯函数（启动阶段等，可被自检脚本直接 import）
  views/              页面：各功能子目录 + IndexView.vue、SetupView.vue
src-tauri/            Rust 侧与打包配置
  src/                进程、游戏、文件、诊断等模块
  capabilities/       Tauri v2 权限清单
  icons/              打包图标（png / ico / icns）
  desktop/            Linux .desktop 模板
  tauri.conf.json     窗口、bundle、各平台配置
scripts/              自检、图标生成、版本同步、端口清理
docs/                 构建产物记录等文档
.github/workflows/    release 工作流
```

## 许可证

Apache License 2.0，全文见 [LICENSE](LICENSE)。
