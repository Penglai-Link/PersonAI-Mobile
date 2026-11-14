# PersonAI Mobile

**把电脑上的 AI 工作台，装进你的口袋。**

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-3B82F6?style=flat-square"></a>
  <img alt="Platforms: iOS, Android, iPad" src="https://img.shields.io/badge/platform-iOS%20%7C%20Android%20%7C%20iPad-111827?style=flat-square">
  <a href="https://expo.dev"><img alt="Expo SDK 58" src="https://img.shields.io/badge/Expo-SDK%2058-000020?style=flat-square&logo=expo&logoColor=white"></a>
  <a href="https://reactnative.dev"><img alt="React Native 0.88" src="https://img.shields.io/badge/React%20Native-0.88-61DAFB?style=flat-square&logo=react&logoColor=black"></a>
  <a href="https://github.com/Penglai-Link/PersonAI-Mobile/pulls"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-22C55E?style=flat-square"></a>
</p>

PersonAI Mobile 是 Person-AI 生态的开源移动客户端。它把运行在电脑、家庭服务器或内网机器上的
AI 节点，收进一个随时可用的手机控制台：看板掌握全局，侧边抽屉切换产品，对话继续未完成的工作。
节点直连、会话不落盘，不经过第三方中转。

<p align="center">
  <img src="docs/screenshots/dashboard.png" width="220" alt="跨节点看板">
  <img src="docs/screenshots/drawer-session-tree.png" width="220" alt="产品、节点与会话层级的侧边抽屉">
  <img src="docs/screenshots/chat-dude.png" width="220" alt="与 Dude 的流式对话">
</p>
<p align="center"><sub>跨节点看板 · 产品 / 节点 / 会话树 · 与 Dude 的流式对话（演示数据）</sub></p>

> An open-source mobile console for self-hosted Person-AI nodes. iOS, Android and iPad. Built with
> Expo, React Native and TypeScript.

## 为什么做这个

桌面端擅长执行，手机端擅长在场。你不在工位时，仍可能想知道哪台机器上还有会话在跑、某个
Dude 有没有新的结果，或者顺手把一句话发给远程节点。打开笔记本、连 VPN、再找到那个窗口，
成本太高。

PersonAI Mobile 不做桌面端的缩水版。它只保留移动场景真正需要的部分：看到全局、快速切换、
继续对话。执行、文件与工具调用仍发生在你的电脑上，手机只负责发起和呈现。

## 核心体验

### 一块看板，聚合所有节点

首页同时汇总所有产品与节点：产品数、在线节点、会话总数、运行中会话，以及跨节点的 Dude
卡片。点开 Dude 或运行中的会话，才会绑定对应节点进入聊天——看板本身不会为了汇总而切换
当前节点。

不需要先选电脑再看数据，也不会因为某台机器离线就丢掉其它机器的视图。

### 抽屉就是导航，没有汉堡按钮

从任意页面屏幕左缘向右滑，打开产品 / 节点 / 会话树：

```text
产品
└── 节点
    └── 会话分组
        └── 会话
```

- Tron Harness 按「主题 / 目录 / 随聊」分组，对应项目、目录与会话。
- 其他产品收敛为单层会话列表。
- 一个产品下的多个节点会并列展示，不存在“当前节点”的全局选择态。
- 会话内容按需读取、只存内存；抽屉每次打开时刷新，切换节点或离线后清空。

抽屉右上角固定放扫码配对与设置，导航和配置不再散落在各个页面。

### 对话是流式的

聊天走 SSE，增量渲染回复；运行时拿不到可读流时，自动降级为普通 `POST` + 轮询，并在界面
说明当前模式。输入框支持多行，发送状态、错误重试与离线状态都有独立反馈。

没有 WebView 套壳。消息、会话行与抽屉都是原生组件，长列表滚动和键盘处理交给平台。

### 安全边界写进默认值

| 数据 | 位置 | 生命周期 |
| --- | --- | --- |
| 配对令牌 | `expo-secure-store`，按节点分键 | 删除节点或重新配对前有效 |
| JWT access token | **仅内存** | 短期有效；401 自动换新，切换节点、进入后台或离线时清空 |
| 会话列表与消息 | **仅内存** | 同上，退出应用即消失 |
| 产品、节点元数据、主题与语言 | AsyncStorage | 持久保存 |

- 远程节点默认只允许 HTTPS；`http://` 需要显式开启“不安全调试”并二次确认，否则在发出任何
  请求前就被拦截。
- 401 自动用配对令牌重新换取一次 JWT；再失败则标记离线并提示重新配对。
- 手机丢失时，没有可复用的会话凭证，也没有聊天记录可读。

### 属于移动端的界面

四套内置主题色、浅色 / 深色 / 跟随系统，以及简体中文 / English。主题完全属于手机端，
不读取、也不同步节点皮肤；切换语言即时生效并保存在本机。

<p align="center">
  <img src="docs/screenshots/settings.png" width="230" alt="设置页的外观、语言与产品定义">
  <img src="docs/screenshots/dashboard-light.png" width="230" alt="浅色模式下的看板">
</p>
<p align="center"><sub>主题、语言与产品定义 · 浅色模式（演示数据）</sub></p>

### 产品是可扩展的容器

内置产品开箱可用，也可以在设置里添加自定义产品编码。节点通过扫码或手动输入配对，客户端
以节点上报的 `productCode` 为准；产品不匹配时会自动归入正确产品并给出提示。

| 产品 | 编码 | 移动端能力 |
| --- | --- | --- |
| Tron Harness | `tron` | 主题 / 目录 / 随聊分组、Dude、工作区、流式会话 |
| 运维智能体 | `axiom-agent` | 节点会话、工作区与 Dude 汇总 |
| 小说智能体 | `novel-agent` | 节点会话、工作区与 Dude 汇总 |
| GitDeck | `git-deck` | 节点会话、工作区与 Dude 汇总 |
| 自定义产品 | 小写字母、数字、`.`、`-` | 单层会话列表，可随时添加或删除 |

内置产品不可删除；删除自定义产品会一并删除其节点与配对令牌。

## 适合谁

- 在多台电脑或家庭服务器上跑不同 AI agent，需要统一入口的人。
- 经常离开工位，但希望随时查看运行状态、继续对话的人。
- 在意数据边界，不想把会话交给第三方云的人。
- 想基于 Person-AI 协议扩展自己的移动端入口的开发者。

## 快速开始

### 准备

- 一个已开启远程访问的 Person-AI 节点，推荐 Tron Harness；移动端兼容 v2 与旧版 v1
  配对二维码。
- Node.js 22.13+（22 / 24 / 26 系列），建议使用 24 LTS。
- 安装 Expo Go 的设备，或自建开发构建。

### 运行

```bash
git clone https://github.com/Penglai-Link/PersonAI-Mobile.git
cd PersonAI-Mobile
npm install
npm run start
```

启动后按终端提示，用 Expo Go 或开发构建打开。桌面端生成配对二维码（`tron://pair`），在
抽屉右上角扫码即可；也可以选择手动输入节点名称、地址与配对令牌。

> 公网接入请在 FRP 或反向代理层终止 TLS，并转发 `X-Forwarded-Proto: https`。局域网明文
> HTTP 只用于可信调试环境，需要逐个节点显式允许。

### 构建原生包

本仓库不要求本机安装完整 Xcode / Android SDK，原生包通过 EAS Build：

```bash
npx eas-cli build --platform ios --profile preview
npx eas-cli build --platform android --profile preview
```

正式分发使用 `--profile production`。

## 技术栈

- Expo SDK 58、React Native 0.88、React 19、TypeScript 6。
- `@react-navigation/native` + native-stack；顶层是自绘侧边抽屉，不使用 Expo Router，
  也不引入需要原生重建的 drawer 依赖。
- 网络与 SSE 使用 `expo/fetch`，流式不可用时降级为普通请求 + 轮询。
- 配对令牌使用 `expo-secure-store`；产品、节点与偏好使用 AsyncStorage，会话内容永不持久化。
- 扫码使用 `expo-camera`；主题与文案完全由 `src/theme` 与 `src/i18n` 提供。

## 项目结构

```text
src/
  screens/       看板、节点、聊天、设置
  navigation/    原生栈与自绘抽屉
  store/         产品 / 节点元数据、JWT 与会话生命周期
  api/           HTTP、SSE 与响应归一化
  theme/         内置主题与调色板
  i18n/          中文源文案与英文翻译
  components/    卡片、徽标、消息气泡等共享组件
```

## 开发

```bash
npm run typecheck             # tsc --noEmit
npx expo export --platform web
npx expo-doctor
```

提交前以上三条必须全部通过。UI 与流程验证以 Web 预览和后端联调为主。开始改动前请阅读
[AGENTS.md](AGENTS.md)，其中记录了导航、请求闸门、会话持久化与主题 / 国际化的架构约束。

## 集成参考

<details>
<summary>配对二维码格式与移动端使用的接口</summary>

v2（推荐，桌面端当前格式）：

```text
tron://pair?v=2&url=<urlencoded baseUrl>&token=<token>&name=<urlencoded machineName>&product=tron&productName=Tron&node=<nodeId>&secure=1
```

v1 兼容旧桌面端：缺少 `product` / `node` / `secure` 时按 Tron 产品处理，`secure` 由 URL
scheme 推断。

响应统一为 `{ code, message, data }`，成功 code 为 `SUCCESS` 或 `0`。

- `POST /api/v1/remote/session`：`Authorization: Bearer <pairingToken>`，换取
  `{ accessToken, expiresIn, identity }`。
- `GET /api/v1/remote/identity`：JWT 认证，返回节点 identity。
- `GET /api/v1/health`：无需认证，用于在线探测。
- Dude、工作区、主题会话、随聊、消息与流式接口沿用 Tron 后端契约；工作区相关请求携带
  `workspaceCode`，引导时的第一次工作区列表请求除外。

完整契约以 Tron 主仓库的 `tron-backend/src/adapters/inbound/http/remote_access.rs` 与
后端 README 为准。

</details>

## 已知限制

- 项目处于早期预览阶段：已通过 `tsc`、Web 导出与 `expo-doctor` 验证，真机与商店分发仍在完善。
- Web 预览没有 SecureStore，配对令牌会退化为 AsyncStorage；Web 只用于调试和打包验证，
  不是受支持的生产安全目标。
- 会话树每个节点只读取第一个 ACTIVE 工作区，多工作区节点暂不会合并展示。
- 消息目前按纯文本展示，不渲染 Markdown，也不处理附件。
- 节点的“不安全调试”标记保存后不能单独撤销，需要删除节点后重新配对。

## 贡献

Issue 和 PR 都欢迎。提交前请先读 [AGENTS.md](AGENTS.md)，并保持三个检查命令通过。涉及
网络、会话持久化或导航手势的改动，请在 PR 中说明安全边界与验证方式。

如果这个项目对你有用，欢迎点一个 Star，让更多人发现它。

## License

[GNU Affero General Public License v3.0](LICENSE) © Person-AI

PersonAI Mobile 是自由软件：你可以使用、修改和分发，但通过网络提供服务时需要按 AGPL
公开对应的源代码。