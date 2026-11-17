# PersonAI Mobile 图标

深空轨道版 “A” 标识：保留原图标的单字母识别，用蓝色渐变、行星轨道和卫星节点表达“个人 AI 节点 / 远程连接”。

## 设计规范

- 画布：1024 × 1024，满版，不预切圆角；iOS 与 Android 各自裁切。
- 背景：`#050608` → `#0A1424` → `#142844` 径向渐变，中心略偏上。
- 主渐变：`#A7F6FF` → `#55C8FF` → `#2F7BFF` → `#7B4DFF`。
- 轨道：`#58C8FF`，透明度 50%，向后穿过字母，保持 “A” 完整。
- 节点：白色高光核心 + `#4CC9FF` 光晕，落在轨道右侧。
- 光晕：栅格阶段用高斯模糊合成，避免透明前景出现滤镜方块。

## 文件

- `icon.svg`：主图标几何源文件（含背景）。
- `foreground.svg`：Android 自适应前景，内容缩放到安全区。
- `monochrome.svg`：Android 主题图标，单色 “A”。
- `background.svg`：Android 自适应背景。
- `generate.py`：从 SVG 生成全部平台资源。

## 重新生成

```sh
python3 design/app-icon/generate.py
```

脚本会更新：

- `assets/icon.png`、`assets/splash-icon.png`、`assets/favicon.png`
- `assets/android-icon-{background,foreground,monochrome}.png`
- iOS `App-Icon-1024x1024@1x.png`
- Android 各密度 `ic_launcher*`、`splashscreen_logo.png`

依赖 `rsvg-convert` 与 Pillow。原生目录已被 `.gitignore` 忽略，`assets/` 才是提交源。
