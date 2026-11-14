# PersonAI Mobile

PersonAI Mobile 是 Person-AI 生态的 Expo + React Native + TypeScript 移动客户端，支持
iOS、Android 与 iPad。它用于管理局域网或 FRP 穿透后的 Tron 等产品节点。
仓库目录与 Tron 主仓库同级：`PersonAI-Mobile`。

## 技术栈

- Expo SDK 58、React Native 0.88、React 19、TypeScript 6。
- 导航：`@react-navigation/native` + native-stack（不使用 Expo Router），顶层使用自绘
  侧边抽屉（`src/navigation/Drawer.tsx`），不额外引入原生手势依赖。
- 安全存储：`expo-secure-store` 保存每个节点的配对令牌。
- 本地元数据：AsyncStorage 只保存产品、节点、主题偏好与界面语言；不保存会话或消息。
- 网络：`expo/fetch`；聊天优先使用流式 SSE，运行时拿不到可读 body 时降级为普通
  `POST /messages` + 轮询。
- 主题：移动端内置主题（默认 / 海蓝 / 紫罗兰 / 琥珀）+ 浅色 / 深色 / 跟随系统；
  不读取、不同步节点皮肤。
- 语言：简体中文 / English，界面文案立即切换并保存在本机。

## 命令

```bash
npm install
npm run typecheck             # tsc --noEmit
npx expo export --platform web
npx expo-doctor
npm run start                 # Expo 开发服务器（Expo Go / 开发构建）
```

本机没有完整 Xcode / Android SDK。需要原生包时使用 EAS Build，不要手写 `ios/` 或 `android/`。

## 使用流程

### 1. 看板与侧边抽屉

默认首页是移动端看板，展示：

- 产品数、有节点的产品数。
- 节点数与在线节点数。
- 会话总数与运行中的会话数。
- 跨节点的 Dude 卡片；点击后按该节点创建 Dude 会话并进入聊天。
- 运行中的会话列表，点击直接进入对应节点的聊天。

从屏幕左缘向右滑打开侧边抽屉。
抽屉头部左侧是 “PersonAI Mobile”，右侧依次是：

- **扫码**图标：直接打开扫码配对流程。
- **设置**齿轮：进入移动端设置。

抽屉内容只展示**有节点的产品**，结构为：

```text
产品
└── 节点
    └── 会话分组（按产品能力）
        └── 会话
```

- Tron Harness（`tron`）按“主题 / 目录 / 随聊”分组：有 `projectCode` 的会话归入主题，
  仅在 `directoryCode` 的会话归入目录，两者都没有的归入随聊。
- 其他产品目前只有一层“会话”列表。
- 没有“当前节点”的选择态；一个产品下的多个节点都会展开在树里。点击某个会话时才绑定
  对应节点并打开聊天。
- 会话与 Dude 数据在展开节点 / 加载看板时按需读取，只放在内存；抽屉每次重新打开会
  刷新已展开节点，切换节点、App 进入后台或离线时清空。
- 产品定义在设置页维护；节点通过扫码/手动添加流程创建，并在节点列表中刷新或删除。

内置产品定义固定且不可删除，当前包括：

| 编码 | 显示名 |
| --- | --- |
| `tron` | Tron Harness |
| `axiom-agent` | 运维智能体 |
| `novel-agent` | 小说智能体 |
| `git-deck` | GitDeck |

点击产品进入该产品的节点列表。自定义产品的添加与删除移到“设置 → 产品定义”。

### 2. 节点列表

只显示当前产品的节点，卡片展示名称、地址与在线状态。

- 添加节点支持扫码（`tron://pair` 二维码）和手动输入名称/地址/配对令牌。
- 保存前调用 `POST /api/v1/remote/session` 换取 JWT 并读取 identity；验证通过后才保存，
  同时记录 `productCode`、`nodeId`、机器名、平台、版本与 profile。
- 如果 identity 的 `productCode` 与当前产品不一致，会**自动归入 identity 的产品**（必要时
  自动创建该产品），并弹出明确的“产品已自动纠正”提示。
- 删除节点会删除 SecureStore 中的配对令牌。
- 从屏幕左缘向右滑打开抽屉；节点列表仍支持刷新、扫码/手动添加与长按删除。
- 空状态的“扫码添加”直接进入扫码页；页头 + 图标打开可切换扫码/手动输入的添加节点页。

### 3. 节点首页

进入节点后：内存中换取短期 JWT → 加载 Dude、工作区、随聊、主题会话；原有 Home 功能
（新建随聊、Dude 会话、工作区切换、主题分组、聊天、流式回复与非流式降级）保留。

### 4. 设置

抽屉中的“设置”页集中管理移动端偏好：

- 外观：浅色 / 深色 / 跟随系统，以及默认 / 海蓝 / 紫罗兰 / 琥珀四种主题色。主题只用
  内置调色板生成强调色，不读取节点皮肤，也不修改电脑端主题。
- 界面语言：简体中文 / English；切换立即生效并保存到本机。
- 产品定义：添加 / 删除产品。上述内置产品不可删除；删除自定义产品会一并删除其节点与
  配对令牌。产品编码只允许小写字母、数字、点和连字符。

## 安全模型

### 两层令牌

| 令牌 | 用途 | 保存位置 |
| --- | --- | --- |
| 配对令牌（pairing token） | 只用于 `POST /api/v1/remote/session` 换取 JWT | `expo-secure-store`（按节点 id 分键） |
| JWT access token | 之后所有 API 的 `Authorization: Bearer` | **仅内存**，不写任何持久化存储 |

- JWT 过期时间取自 `expiresIn`；剩余不足 60 秒时重新换取。
- 抽屉会话树会为被展开的节点按需换取短期 JWT，同样只保存在内存（按节点缓存）；App 进入
  后台时清空。
- 任何请求返回 HTTP 401 时，自动再用配对令牌换取一次 JWT 并重试；再失败则标记离线并提示
  “配对令牌无效或已过期，请重新配对”。
- 节点切换、App 进入后台/非活跃状态、离线时都会清空内存中的 JWT 与会话内容；回到前台后
  通过健康检查重连。
- 不使用自研加密、`react-native-ssl-pinning` 或 WebView；JWT 与 HTTPS 由后端与平台 TLS 负责。

### HTTPS 策略

远程节点默认必须使用 HTTPS：

- `https://...` 正常连接。
- `http://...`（含省略 scheme 被归一化为 http 的地址）只有在节点被显式标记为
  “不安全调试”并且用户再次确认后才允许；此时控制台会弹出明文传输风险确认。
- 未允许时直接显示安全错误，**不会发出任何请求**（添加节点、换取 JWT、健康探测、业务请求
  都在同一道闸门后）。
- 扫码配对 URI 的 `secure` 字段用于提示；旧版 v1 二维码按 URL scheme 推断。
- 电脑端本身也会拒绝非 HTTPS 远程访问（除非在电脑端显式允许不安全 HTTP）；
  `app.json` 中 iOS ATS / Android cleartext 仅为让“不安全调试”在原生端可用，真正生效的
  拦截在 JS 安全闸门。

公网接入请在 FRP 或反向代理层终止 TLS，并转发 `X-Forwarded-Proto: https`。

### 在线探测与离线

- 前台每 15 秒调用 `GET /api/v1/health`（无需认证）探测当前节点；App 回到前台时立即探测。
- 探测失败或任意请求出现超时/连接失败，立即标记节点离线、清空首页与聊天内容，并显示
  “电脑离线”，不展示旧会话。
- HTTP 业务错误（非传输失败）不会当作离线；401 走上面的 JWT 刷新流程。
- 恢复在线后自动重连并重新拉取数据。

### 不持久化会话

- AsyncStorage 只保存：产品定义、节点连接元数据、主题偏好与界面语言。
- 配对令牌只在 SecureStore；JWT、会话列表、消息、流式文本只在内存。
- 退出应用或重启后回到看板，不恢复任何会话内容。
- 旧版单一电脑列表（`@tron/connections/v1`）会在首次启动时迁移为 Tron 产品的节点，
  配对令牌沿用原 SecureStore 键。

## 配对二维码

v2（推荐，桌面端当前格式）：

```text
tron://pair?v=2&url=<urlencoded baseUrl>&token=<token>&name=<urlencoded machineName>&product=tron&productName=Tron&node=<nodeId>&secure=1
```

v1（兼容旧桌面端）：没有 `product` / `node` / `secure` 字段时按 Tron 产品处理，
`secure` 由 URL scheme 推断：

```text
tron://pair?v=1&url=<urlencoded baseUrl>&token=<token>&name=<urlencoded machineName>
```

## 后端接口契约（移动端使用）

响应统一为 `{ code, message, data }`，成功 code 为 `SUCCESS` 或 `0`。

- `POST /api/v1/remote/session`
  - 请求头 `Authorization: Bearer <pairingToken>`，无请求体。
  - data：`{ accessToken, expiresIn, identity: { protocolVersion, productCode, productName, nodeId, machineName, version, platform, baseUrl, profile } }`。
- `GET /api/v1/remote/identity`：JWT 认证，返回 identity 对象。
- `GET /api/v1/health`：无需认证，用于在线探测。
- Dude、工作区、主题会话、随聊、消息、发送、流式等原有接口路径与参数不变，认证改为 JWT；
  工作区相关的后续请求都会带 `workspaceCode` 查询参数。第一次拉取工作区列表时尚不知道
  workspaceCode，因此该次引导请求不带该参数。

## 主题与语言

- 主题是移动端本地概念，不消费节点皮肤接口（`GET /api/v1/system/skins` 与
  `GET /api/v1/system/skins/active` 不再被调用）。
- 明暗模式存 `@personai/theme/mode/v1`；主题色存 `@personai/theme/preset/v1`。
- 四种主题只替换强调色与 `onAccent`，surfaces、文字与语义色保持移动端统一规范；
  强调色的柔色背景和描边由透明度推导。
- 语言存 `@personai/language/v1`；首次启动按系统 locale 选择中文或英文。
- 界面文案通过 `src/i18n` 的中文字面量字典翻译，未翻译的字符串回退为中文。

## 已知限制

- 未做真机验证。验证范围是 `tsc`、`expo export --platform web`、`expo-doctor`，以及在
  无头 Chrome 中跑通 Web 预览的主要流程（抽屉、设置、语言/主题切换、配对、JWT、流式、
  离线、清理）。
- Web 预览没有 SecureStore 实现，配对令牌会退化为 AsyncStorage；Web 只用于调试/打包验证，
  不是受支持的生产安全目标。
- 抽屉使用核心 `Animated` + `PanResponder`：任意页面从屏幕左缘向右滑打开，点击遮罩或
  按原生返回键 / Web Esc 关闭。原生侧滑返回已关闭，避免和抽屉手势争抢左缘；返回统一用
  页头返回按钮。
- 会话树每个节点只读取第一个 ACTIVE 工作区；多工作区的节点暂不会把所有工作区的会话合并
  展示。
- 只有 Tron Harness 使用“主题 / 目录 / 随聊”分组，其他产品目前是单层会话列表。
- 节点的“不安全调试”标记保存后不能单独撤销；需要删除节点后重新配对。
- 消息按纯文本展示，不渲染 Markdown、不处理附件（与原行为一致）。
- 离开节点回到节点列表时保留当前内存会话；选择另一个节点才会切换并清空。
- 抽屉会话树只读取每个节点的第一个 ACTIVE 工作区，多工作区节点的会话暂不会全部展示。