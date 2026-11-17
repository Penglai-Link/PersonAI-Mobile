# PersonAI-Mobile

PersonAI Mobile 的 Expo + React Native 移动端，目录与 Tron 主仓库同级。只允许修改本目录。
协议与整改契约以 `../docs/remote-access-remediation.md` 为准；客户端实现入口是
`src/api/tunnel.ts`、`src/api/rpc.ts`、`src/crypto/noise.ts`。

## 技术栈

- Expo SDK 58、React Native 0.88、React 19、TypeScript 6。
- 导航使用 `@react-navigation/native` + native-stack，不使用 Expo Router。顶层导航壳是自绘
  侧滑菜单（`src/navigation/Drawer.tsx`），不要引入需要原生重建的 drawer 依赖。
- 远程网络使用 WebSocket + Noise IK（`src/api/tunnel.ts`）；业务统一走 RPC，不使用 `expo/fetch` 业务请求，也不再有 SSE 直连。
- 本机没有完整 Xcode / Android SDK。需要原生包时使用 EAS Build，不要手写 `ios/` 或 `android/`。

## 架构约束

- 产品与节点：`src/store/connections.tsx`。产品/节点元数据存 AsyncStorage
  （`@personai/products/v1`、`@personai/nodes/v1`；启动时兼容迁移旧 `@tron/*`）。内置产品编码为
  `tron`（Tron Harness）、`axiom-agent`、`novel-agent`、`git-deck`，启动时会自动补齐并对齐
  显示名，且不可删除。
  产品定义（添加/删除）只在设置页维护；不保留独立的产品列表页。
- 每节点设备私钥存 `expo-secure-store`（键 `personai.devicekey.<nodeId>`）。Web 预览没有
  SecureStore，退化为 AsyncStorage 并标记 `insecure`，仅用于调试；旧 token/JWT 记录不再迁移。
- 会话：`src/store/nodeSession.tsx`。连接先做 Noise IK + `auth`，`ready` 返回 deviceId/methods；
  没有 JWT。切换节点、App 进入后台、离线时关闭隧道并清空内存会话。
- **禁止**把设备私钥、会话列表、消息、聊天历史写入 AsyncStorage。设备私钥只能进 SecureStore。
- 所有远程业务请求必须经过 `NodeSession.request` / `requestForNode` 或 `SecureTunnel.call/stream`，
  以统一处理认证、设备吊销、离线判定与通道重连。
- 侧滑菜单没有常驻入口按钮：任意页面从屏幕左缘向右滑打开；菜单右上角有扫码与设置入口。原生
  栈必须保持 `gestureEnabled: false`，让侧滑菜单独占左缘手势；返回统一用 `AppHeader onBack`。
  设置页集中主题、语言与产品定义，不要在其它页面另开入口。
- 默认首页是看板（`src/screens/DashboardScreen.tsx`）：产品/节点/会话/运行中指标、跨节点
  个人助手、运行中会话。看板通过 `loadNodeOverview` 汇总每个节点，不要为汇总切换当前节点。
- 侧滑菜单会话树：只展示有节点的产品，结构为产品 → 节点 → 工作空间 → 一级分组 →
  二级分组 → 会话。一级分组来自产品返回的导航菜单（`tron.navigation.menus`，
  Tron 为 主题 / 工作区 / 随聊），二级分组来自项目/目录数据；不得写死分组名称和顺序。
  其他产品没有导航分组时退化为单层会话列表。树数据必须通过
  `NodeSession.requestForNode(node, …)` 按节点读取，不得为了读取树数据切换当前节点，也
  不得新增绕过 HTTPS/JWT 的请求路径。会话元数据仅缓存在内存中。
- 传输只有两种：`https -> public(WSS)`、`http -> lan(WS)`；两种都必须有配对时固定的 `nodeKey`。
  没有 `allowInsecure` 开关，也不允许明文业务请求；不要新增绕过隧道的请求代码。
- 主题：`src/theme/`。移动端自有主题，绝不读取或同步节点皮肤；新增或修改界面必须使用
  `useTheme()` / `useThemedStyles(createStyles)`，不允许再引入静态 `colors`；`createStyles`
  工厂放在模块顶层以保持 memo 稳定。
- 语言：`src/i18n`。新增界面文案必须走 `useI18n()` 的 `t()` / `format()`（非组件模块用
  `translate()`），并在 `src/i18n/messages.ts` 补英文；不要把中文硬编码在 JSX 或参数里。
  语言偏好存 `@personai/language/v1`。
- Agent UI：聊天持久消息使用 `@personai/agent-ui-chat-react-native` 的 `MessageBubble`；
  A2UI 消息通过其内嵌的 `@personai/agent-ui-a2ui-react-native` 渲染，不要把 web 的
  `chat-react`/`a2ui-react` 或 CSS 引入 RN。这些包来自同级 `../eliteforge-agent-ui/packages`，
  使用 npm 版本 `1.0.0-preview.21`（agent-ui 已发布），不要再用 `file:` 本地依赖。
- 节点支持双地址：`SavedNode` 保存 `lanBaseUrl` / `publicBaseUrl`，`baseUrl` 是当前活动
  endpoint；`tunnelEndpoints` 按 LAN → public → 当前地址顺序探测，`SecureTunnelPool`
  逐个回退。网络变化由 `expo-network` 监听并重新 probe；不要假设节点只有单地址。
- 新增业务接口时：优先注册 `session.*` 通用 RPC；Tron 特有数据用 `tron.*` 方法。
  `rpc_event.data` 直接是 AG-UI 事件，不要自定义第二套事件名；未知事件必须忽略。
  工作区相关参数通过 RPC params 传递。

## 命令

```bash
npm run typecheck
npx expo export --platform web
npx expo-doctor
```

提交前以上三条必须全部通过。不写单元测试；UI/流程验证以 Web 预览与后端联调为主。