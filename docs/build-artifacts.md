# 构建产物记录

`release.yml` 里写的产物路径与文件名后缀，来自 Tauri 的命名约定，**尚未经实测**。
Windows / Linux / macOS 三套命名都是约定值，首次 `workflow_dispatch` 演练后把真实输出补到下面，
供 Tauri 升级时对照。

## 抓取方式

```bash
ls -R src-tauri/target/release/bundle
# macOS 通用目标（--target universal-apple-darwin）的产物不落在默认目录下：
ls -R src-tauri/target/universal-apple-darwin/release/bundle
```

## 工作流中登记的路径

| 平台              | 登记路径                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| Windows msi       | `src-tauri/target/release/bundle/msi/bloomery-gui_<版本>_x64_en-US.msi`                             |
| Windows nsis      | `src-tauri/target/release/bundle/nsis/bloomery-gui_<版本>_x64-setup.exe`                            |
| Windows 便携      | `src-tauri/target/release/bloomery-gui.exe` 压成 zip                                                |
| Linux deb         | `src-tauri/target/release/bundle/deb/bloomery-gui_<版本>_amd64.deb`                                 |
| macOS 通用 dmg    | `src-tauri/target/universal-apple-darwin/release/bundle/dmg/bloomery-gui_<版本>_universal.dmg`      |
| macOS 通用 app+zip | `src-tauri/target/universal-apple-darwin/release/bundle/macos/bloomery-gui.app` 压成 zip            |

CI 抓取时统一改名为 `bloomery-gui-<版本>-<平台后缀>`：Windows 为 `-windows-x64-*.msi` /
`-windows-x64-setup.exe` / `-windows-x64-portable.zip`，Linux 为 `-linux-x64.deb`，
macOS 为 `-macos-universal.dmg` / `-macos-universal.zip`。改名后的附件名同样**未实测**。

## macOS（universal）

- 构建命令：`pnpm tauri build --target universal-apple-darwin --bundles app,dmg`
- `--bundles` **必须带 `app`**：Tauri 在只打 `dmg` 时会清理生成的 `.app`
  （tauri-bundler 的 “Clean up .app if only building dmg or updater”），这样 zip 无内容可压。
  v1.7.0 的首次演练就是踩在这里：日志里 `bundle/macos` 是空目录、只有 dmg
- dmg 与 `.app` 里的二进制是通用二进制（`lipo -archs` 应含 `x86_64` 与 `arm64`），`Info.plist` 的
  `CFBundleShortVersionString` 取 `tauri.conf.json` 的版本号
- `bundle.macOS.signingIdentity` 设为 `"-"`：没有 Apple 证书时也由 codesign 做 ad-hoc 签名，
  `.app` 本身带完整签名，首次打开仍需右键「打开」；需要公证时用 `APPLE_CERTIFICATE` /
  `APPLE_SIGNING_IDENTITY` 等环境变量覆盖该值
- 产物目录带 target 名：`src-tauri/target/universal-apple-darwin/release/bundle/{macos,dmg}/`，
  与单架构的 `src-tauri/target/release/bundle/` 不同
- CI 不写死这个路径：归置产物用 `find` 列举 `src-tauri/target` 下所有 `.app` / `.dmg`，优先取
  路径含 `universal-apple-darwin` 的那个，并把候选清单打进步骤日志；Tauri 升级或布局变化时
  不会因“路径对不上”而静默失败
- 最低系统版本 `10.15`（`bundle.macOS.minimumSystemVersion`）；Apple Silicon 需 11+
- CI 用 `macos-14` 运行器；通用目标不挑运行器架构，私有仓库若无 arm64 运行器，换成任意可用的
  macOS 运行器即可（在 Intel 运行器上交叉编译 arm64 切片）
- dmg 文件名已实测（v1.7.0 日志）：`bloomery-gui_1.7.0_universal.dmg`，与登记的
  `bloomery-gui_<版本>_universal.dmg` 一致

## 演练实测

首次演练（tag `v1.7.0`，run `41584979445`，2026-11-03）：

- Windows（msi / nsis setup / 便携 zip）与 Linux（deb）的 package job 全绿，upload-artifact 正常
- macOS：Rust 通用目标编译成功（「打包」步骤 6 分 56 秒）、dmg 生成成功；失败在「归置产物」，
  日志为：

  ```text
  src-tauri/target/universal-apple-darwin/release/bundle/macos          ← 空目录
  src-tauri/target/universal-apple-darwin/release/bundle/dmg/bloomery-gui_1.7.0_universal.dmg
  错误：期望 1 个 app，实际 0
  ```

  根因：`--bundles dmg` 时 Tauri 打包完 dmg 会清掉 `.app`。修复：CI 改为 `--bundles app,dmg`；
  归置产物改为 `find` 全量列举并打印候选；配置加 ad-hoc 签名
- package 失败导致 smoke 与 release job 跳过，macOS 的 dmg 挂载 / Info.plist / 双架构 / 签名校验
  尚未实际跑到，下一次演练补记

```
待补：下一次演练的 macOS 校验步骤输出
```

## 演练要确认的四件事

1. `.msi` 与 `-setup.exe` 的真实文件名后缀（上表登记值为约定，未实测）
2. Windows `tauri build` 是否接受当前这套全透明图标
3. 打包器是否读到 `bundle.icon` 的每一项（编译期只读第一个 `.png` 与第一个 `.ico`）
4. macOS **已确认**：universal 产物在 `target/universal-apple-darwin/release/bundle/`，
   dmg 名为 `bloomery-gui_<版本>_universal.dmg`，且「只打 dmg 会清掉 `.app`」。下次要确认
   ad-hoc 签名、zip 内 `.app`、smoke 启动检查都通过

## 图标验证的覆盖边界

- Linux 的 `cargo check` 对图标改动 **零覆盖**：`bundle.icon` 第一项 `32x32.png` 即被选中，`icons/icon.png` 作为兜底不被读；`.ico` 属 Windows 资源，平台门控
- `icons/icon.icns` 只在 **macOS 打包**（dmg / app）时被读，Windows 与 Linux 打包不会碰它
- 真会读图标的是打包：Linux `--bundles deb`、Windows `tauri build`、macOS `--bundles app,dmg`
- 列表每一项的存在性由 `pnpm run check:icons` 断言（CI 阻塞）；`.icns` 还会额外校验结构：
  `icns` magic、头部长度字段等于文件大小、逐条目长度不小于 8 且不越界、至少含
  `ic07` / `ic08` / `ic09` / `ic10` 之一
- `.icns` 由 `pnpm run icons:icns`（`scripts/make-icns.mjs`）从已有的几档 PNG 拼出，可重复生成且字节稳定；换图标后要重跑，否则 macOS 打包用的还是旧图
- `pnpm run check:icns` 断言磁盘上的 `icon.icns` 与当前 PNG 逐字节一致，CI 阻塞：改了 PNG 没重跑生成脚本会直接失败

## 独立复核（v1.0.2，对方拆包实测）

Release 附件名（v1.0.2 实证）：

```
bloomery-gui-1.0.2-windows-x64-en-US.msi        5,599,232 B
bloomery-gui-1.0.2-windows-x64-zh-CN.msi        5,595,136 B
bloomery-gui-1.0.2-windows-x64-setup.exe        4,972,450 B
bloomery-gui-1.0.2-windows-x64-portable.zip     5,348,390 B
bloomery-gui-1.0.2-linux-x64.deb                5,985,376 B
```

两处与 v1.0.0 的差异：

1. **msi 带语言段**：v1.0.0 只有 `-windows-x64.msi` 一份；v1.0.1 起为 `en-US` 与 `zh-CN` 两份（对应「安装包多语言」那次改动）
2. 便携 zip 内就一个 `bloomery-gui.exe`，8,005,120 字节

`.deb` 拆包结果（透明图标被接受 ✓）：

```
usr/bin/bloomery-gui
usr/share/icons/hicolor/{32x32,128x128,256x256@2,512x512}/apps/bloomery-gui.png
usr/share/applications/bloomery-gui.desktop          Exec=bloomery-gui · Icon ✓ · StartupWMClass ✓
```

已知瑕疵（`.desktop`，待修）：`Comment=A Tauri App`（模板默认值）、`Categories=`（空，菜单归类会落到「其他」）
