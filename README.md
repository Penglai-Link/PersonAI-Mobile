# PersonAI Mobile

PersonAI Mobile 是 Person-AI 生态的 Expo + React Native + TypeScript 移动客户端，支持
iOS、Android 与 iPad。它用于管理局域网或 FRP 穿透后的 Tron 等产品节点。
仓库目录与 Tron 主仓库同级：`PersonAI-Mobile`。

## 技术栈

- Expo SDK 58、React Native 0.88、React 19、TypeScript 6。
- 导航：`@react-navigation/native` + native-stack（不使用 Expo Router）。
- 安全存储：`expo-secure-store` 保存每个节点的配对令牌。
- 本地元数据：AsyncStorage 只保存产品、节点、主题偏好；不保存会话或消息。
- 网络：`expo/fetch`；聊天优先使用流式 SSE，运行时拿不到可读 body 时降级为普通
  `POST /messages` + 轮询。
- 主题：运行时 `ThemeProvider` 把节点皮肤的 CSS 变量映射为移动端调色板。

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

### 1. 产品列表（新首页）

内置产品 `tron`（名称 Tron）不可删除。点击产品进入该产品的节点列表。

- “添加产品”输入产品编码与显示名；编码只允许小写字母、数字、点和连字符。
- 自定义产品可删除；删除产品时会同时删除其节点和系统安全存储中的配对令牌。
- 右上角进入“外观与皮肤”。

### 2. 节点列表

只显示当前产品的节点，卡片展示名称、地址与在线状态。

- 添加节点支持扫码（`tron://pair` 二维码）和手动输入名称/地址/配对令牌。
- 保存前调用 `POST /api/v1/remote/session` 换取 JWT 并读取 identity；验证通过后才保存，
  同时记录 `productCode`、`nodeId`、机器名、平台、版本与 profile。
- 如果 identity 的 `productCode` 与当前产品不一致，会**自动归入 identity 的产品**（必要时
  自动创建该产品），并弹出明确的“产品已自动纠正”提示。
- 删除节点会删除 SecureStore 中的配对令牌。
- 顶部返回产品列表。

### 3. 节点首页

进入节点后：内存中换取短期 JWT → 加载 Dude、工作区、随聊、主题会话；原有 Home 功能
（新建随聊、Dude 会话、工作区切换、主题分组、聊天、流式回复与非流式降级）保留。

### 4. 外观

产品列表与节点首页都有“外观与皮肤”入口：

- 列出当前节点 `GET /api/v1/system/skins` 返回的皮肤；节点离线时只显示内置调色板。
- 支持浅色 / 深色 / 跟随系统；默认深色。
- 只把“皮肤 id + 明暗模式”保存到 AsyncStorage；不调用激活接口，不修改电脑端主题。
- 切换立即生效，重启后恢复本地选择（皮肤定义本身不缓存，离线重启时先用内置回退色，
  连接节点后重新应用）。

## 安全模型

### 两层令牌

| 令牌 | 用途 | 保存位置 |
| --- | --- | --- |
| 配对令牌（pairing token） | 只用于 `POST /api/v1/remote/session` 换取 JWT | `expo-secure-store`（按节点 id 分键） |
| JWT access token | 之后所有 API 的 `Authorization: Bearer` | **仅内存**，不写任何持久化存储 |

- JWT 过期时间取自 `expiresIn`；剩余不足 60 秒时重新换取。
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

- AsyncStorage 只保存：产品列表、节点连接元数据、主题偏好。
- 配对令牌只在 SecureStore；JWT、会话列表、消息、流式文本只在内存。
- 退出应用或重启后回到产品列表，不恢复任何会话内容。
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
- `GET /api/v1/system/skins`：JWT，data 为皮肤数组。
- `GET /api/v1/system/skins/active`：JWT，data 为 `{ skin }`（只读，用于本地默认选择）。
- Dude、工作区、主题会话、随聊、消息、发送、流式等原有接口路径与参数不变，认证改为 JWT；
  工作区相关的后续请求都会带 `workspaceCode` 查询参数。第一次拉取工作区列表时尚不知道
  workspaceCode，因此该次引导请求不带该参数。

## 主题映射

皮肤结构：`{ id, name, version, variants: { light, dark }, layout, resources }`。移动端把颜色
变量映射到调色板，缺失或无法解析时使用内置回退色（内置深色即原有深色主题）：

| 调色板 | 优先 CSS 变量 |
| --- | --- |
| background | `--color-background` |
| surface | `--color-surface` |
| surfaceAlt | `--color-surface-container-high` → `--color-surface-container` |
| border | `--color-outline-variant` → `--color-outline` |
| text | `--color-on-surface` |
| muted | `--color-on-surface-variant` → `--color-outline` |
| accent | `--color-primary` → `--color-accent` |
| onAccent | `--color-on-primary` → `--color-on-accent` |
| danger | `--color-error` |
| success | `--color-success` |

- 柔色背景/描边由主色、错误色、成功色按透明度推导（`rgba(...)`）。
- 支持 `#rgb/#rgba/#rrggbb/#rrggbbaa`、`rgb()/rgba()`、`hsl()/hsla()`；其他格式回退。
- `layout`、`resources`（背景图、字体、自定义 CSS）不应用到移动端；间距、字号、圆角保持
  移动端自身规范。

## 已知限制

- 未做真机验证。验证范围是 `tsc`、`expo export --platform web`、`expo-doctor`，以及在
  无头 Chrome 中用本地模拟后端跑通 Web 预览的主要流程（配对、JWT、皮肤、流式、离线、清理）。
- Web 预览没有 SecureStore 实现，配对令牌会退化为 AsyncStorage；Web 只用于调试/打包验证，
  不是受支持的生产安全目标。
- 皮肤只应用颜色变量；背景图、字体与自定义 CSS 未实现。移动端未订阅
  `GET /api/v1/system/skins/events`，皮肤在连接节点或进入外观页时刷新。
- 节点的“不安全调试”标记保存后不能单独撤销；需要删除节点后重新配对。
- 消息按纯文本展示，不渲染 Markdown、不处理附件（与原行为一致）。
- 离开节点回到节点列表时保留当前内存会话；选择另一个节点才会切换并清空。