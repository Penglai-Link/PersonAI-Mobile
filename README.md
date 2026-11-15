# PersonAI Mobile

**让电脑上的 AI 工作台，随时在口袋里。**

<p align="center">
  <b>简体中文</b> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-3B82F6?style=flat-square"></a>
  <img alt="Platforms: iOS, Android, iPad" src="https://img.shields.io/badge/platform-iOS%20%7C%20Android%20%7C%20iPad-111827?style=flat-square">
  <a href="https://expo.dev"><img alt="Expo SDK 58" src="https://img.shields.io/badge/Expo-SDK%2058-000020?style=flat-square&logo=expo&logoColor=white"></a>
  <a href="https://reactnative.dev"><img alt="React Native 0.88" src="https://img.shields.io/badge/React%20Native-0.88-61DAFB?style=flat-square&logo=react&logoColor=black"></a>
  <a href="https://github.com/Penglai-Link/PersonAI-Mobile/pulls"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-22C55E?style=flat-square"></a>
</p>

PersonAI Mobile 是 Person-AI 生态的开源移动客户端。它把你在电脑和家庭服务器上运行的 AI 产品连接起来：一个看板看清全局，一条消息接着聊，重要的审批随手点掉。

执行、文件和工具仍然留在电脑上；手机负责发起任务、查看进度和继续对话。

<p align="center">
  <img src="docs/screenshots/dashboard.png" width="220" alt="跨节点看板">
  <img src="docs/screenshots/drawer-session-tree.png" width="220" alt="按产品、节点和会话组织的侧滑菜单">
  <img src="docs/screenshots/chat-dude.png" width="220" alt="与 Dude 的流式对话">
</p>
<p align="center"><sub>跨节点看板 · 产品、节点与会话 · 与 Dude 的对话（中文界面，演示数据）</sub></p>

## 一块看板，看到所有节点

首页汇总所有产品和节点：产品数量、在线节点、会话总数、运行中的任务，以及来自不同节点的 Dude 卡片。

不用先选一台电脑，一台机器离线也不会遮住其它机器的信息。点开会话时才连接对应节点，看板本身不会打断你正在进行的对话。

## 从屏幕左缘滑出会话树

在任意页面从屏幕左缘向右滑，打开侧滑菜单。菜单按产品、节点、会话三层组织：

```text
产品
└── 节点
    └── 会话分组
        └── 会话
```

- Tron Harness 会继续分为主题、目录和随聊；其他产品只有一层会话列表。
- 同一个产品下的多台电脑会一起列出。
- 会话按需加载，只保存在内存；切换节点或离线后自动清空。

## 回复边生成边显示

聊天使用流式传输，回复生成一部分就显示一部分。输入框支持多行，发送、重试和离线状态都有明确反馈。

界面由原生组件实现，滚动长列表或弹出键盘时更接近系统应用。

## 在家和出门，都能连上

- **在家里**：应用自动走局域网，速度最快。
- **在外面**：通过你自建的 HTTPS 入口连回来，不要求电脑有公网 IP，也不需要手动切换节点。
- **切换**：网络变化时应用会重新选择可用地址；连续不上才标记离线。
- **隐私**：公网链路有 TLS，传输内部还有应用层加密；聊天记录只存在手机内存。

自建 FRP、Cloudflare Tunnel、Tailscale 或反向代理的步骤见
[自建公网隧道](docs/self-hosted-tunnel.md)；协议和实现细节见
[远程访问技术说明](docs/remote-access.md)。

## 安全与隐私

| 数据 | 保存位置 | 保留时间 |
| --- | --- | --- |
| 设备密钥 | 手机系统安全存储，每台电脑单独保存 | 删除节点或重新配对前 |
| 会话与消息 | 只保存在内存 | 退出应用后消失 |
| 产品、节点和界面偏好 | 手机本地存储 | 长期保存 |

- 手机丢失时，电脑端可以远程吊销这台设备。
- 公网入口由你自己控制，不经过 Person-AI 的中转服务。
- 切换节点、退到后台或离线时，内存中的会话内容会清空。

## 为手机设计的界面

四套主题色，支持浅色、深色和跟随系统；界面提供简体中文、English 和 日本語。主题只属于手机，不会跟随某台电脑的皮肤变化。切换语言立即生效，并保存到本机。

<p align="center">
  <img src="docs/screenshots/settings.png" width="230" alt="设置页的主题、语言和产品定义">
  <img src="docs/screenshots/dashboard-light.png" width="230" alt="浅色模式下的看板">
</p>
<p align="center"><sub>主题、语言与产品定义 · 浅色模式（中文界面，演示数据）</sub></p>

## 支持多种产品

内置产品开箱可用，也可以在设置里添加自己的产品编码。节点通过扫码或配对链接完成配对。

| 产品 | 编码 | 手机上的能力 |
| --- | --- | --- |
| Tron Harness | `tron` | 主题、目录和随聊分组，Dude，工作区，流式会话 |
| 运维智能体 | `axiom-agent` | 会话、工作区和 Dude 汇总 |
| 小说智能体 | `novel-agent` | 会话、工作区和 Dude 汇总 |
| GitDeck | `git-deck` | 会话、工作区和 Dude 汇总 |
| 自定义产品 | 小写字母、数字、`.` 或 `-` | 单层会话列表，可随时添加或删除 |

## 开始使用

项目仍在早期预览，安装包和商店分发还在完善。体验流程：

1. 在电脑上启动 Person-AI 服务，开启远程访问。
2. 在手机上安装 PersonAI Mobile。当前只提供开发构建。
3. 用侧滑菜单右上角的扫码入口扫描电脑端二维码；也可以手动粘贴配对链接。

在家同一 Wi-Fi 会自动直连；出门时如果配置了公网入口，应用会自动切换过去。

## 当前限制

- 仍处于早期预览，真机验证和商店分发尚未完成。
- 会话树只读取每台电脑的第一个活跃工作区。
- 消息按纯文本显示，暂不渲染 Markdown，也不支持附件。
- 公网访问需要自行配置隧道；默认不提供中转服务。
- 网页预览只用于调试，不是正式的安全使用方式。

## 文档

- [远程访问技术说明](docs/remote-access.md)：协议、加密、RPC 与自动选路。
- [自建公网隧道](docs/self-hosted-tunnel.md)：FRP、Cloudflare Tunnel、Tailscale、Caddy/Nginx。
- [开发文档](DEVELOPMENT.md) · [AGENTS.md](AGENTS.md)

## 参与贡献

欢迎提交 Issue 和 Pull Request。涉及网络、会话保存或导航手势的改动，请在 PR 中说明安全边界和验证方式。

如果这个项目对你有用，欢迎点一个 Star。

## 许可证

[GNU Affero General Public License v3.0](LICENSE) © Person-AI

PersonAI Mobile 是自由软件：你可以使用、修改和分发。通过网络提供服务时，需要按 AGPL 公开对应的源代码。

---

[开发文档](DEVELOPMENT.md) · [English](README.en.md) · [日本語](README.ja.md) · [AGPL-3.0](LICENSE)
