# 构建产物记录

`release.yml` 里写的产物路径与文件名后缀，来自 Tauri 的命名约定，**尚未经实测**。
首次 `workflow_dispatch` 演练后把真实输出补到下面，供 Tauri 升级时对照。

## 抓取方式

```bash
ls -R src-tauri/target/release/bundle
```

## 工作流中登记的路径

| 平台         | 登记路径                                                                 |
| ------------ | ------------------------------------------------------------------------ |
| Windows msi  | `src-tauri/target/release/bundle/msi/bloomery-gui_<版本>_x64_en-US.msi`  |
| Windows nsis | `src-tauri/target/release/bundle/nsis/bloomery-gui_<版本>_x64-setup.exe` |
| Windows 便携 | `src-tauri/target/release/bloomery-gui.exe` 压成 zip                     |
| Linux deb    | `src-tauri/target/release/bundle/deb/bloomery-gui_<版本>_amd64.deb`      |

## 演练实测

日期：待填　平台：待填

```
待填
```

## 演练要确认的三件事

1. `.msi` 与 `-setup.exe` 的真实文件名后缀（上表登记值为约定，未实测）
2. Windows `tauri build` 是否接受当前这套全透明图标
3. 打包器是否读到 `bundle.icon` 的每一项（编译期只读第一个 `.png` 与第一个 `.ico`）

## 图标验证的覆盖边界

- Linux 的 `cargo check` 对图标改动 **零覆盖**：`bundle.icon` 第一项 `32x32.png` 即被选中，`icons/icon.png` 作为兜底不被读；`.ico` 属 Windows 资源，平台门控
- 真会读图标的是打包：Linux `--bundles deb`、Windows `tauri build`
- 列表每一项的存在性由 `pnpm run check:icons` 断言（CI 阻塞）

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
