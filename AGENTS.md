# PersonAI-Mobile

PersonAI Mobile 的 Expo + React Native 移动端，目录与 Tron 主仓库同级。只允许修改本目录。
后端契约以 `../Tron/tron-backend/src/adapters/inbound/http/remote_access.rs` 与 README 为准。

## 技术栈

- Expo SDK 58、React Native 0.88、React 19、TypeScript 6。
- 导航使用 `@react-navigation/native` + native-stack，不使用 Expo Router。顶层导航壳是自绘
  侧边抽屉（`src/navigation/Drawer.tsx`），不要引入需要原生重建的 drawer 依赖。
- 网络/SSE 使用 `expo/fetch`；流式不可用时降级为普通 POST + 轮询。
- 本机没有完整 Xcode / Android SDK。需要原生包时使用 EAS Build，不要手写 `ios/` 或 `android/`。

## 架构约束

- 产品与节点：`src/store/connections.tsx`。产品/节点元数据存 AsyncStorage
  （`@personai/products/v1`、`@personai/nodes/v1`；启动时兼容迁移旧 `@tron/*`）。内置产品编码为
  `tron`（Tron Harness）、`axiom-agent`、`novel-agent`、`git-deck`，启动时会自动补齐并对齐
  显示名，且不可删除。
  产品定义（添加/删除）只在设置页维护；不保留独立的产品列表页。
- 每节点配对令牌存 `expo-secure-store`（键 `personai.token.<nodeId>`；旧 `tron.token.*` 会在读取时迁移）。Web 预览没有
  SecureStore，退化为 AsyncStorage（`@personai/secure-token/*`），仅用于调试。
- JWT 会话：`src/store/nodeSession.tsx`。JWT 只放内存；401 自动用配对令牌重新换取一次；
  切换节点、App 进入后台、离线时清空内存会话与会话内容。
- **禁止**把 JWT、会话列表、消息、聊天历史写入 AsyncStorage 或 SecureStore。
- 所有远程请求必须经过 `NodeSession.request` 或先 `ensureAccessToken()`，以统一处理
  JWT、401 刷新、离线判定与 HTTPS 闸门。
- 抽屉没有汉堡按钮：任意页面从屏幕左缘向右滑打开；抽屉右上角有扫码与设置入口。原生
  栈必须保持 `gestureEnabled: false`，让抽屉独占左缘手势；返回统一用 `AppHeader onBack`。
  设置页集中主题、语言与产品定义，不要在其它页面另开入口。
- 默认首页是看板（`src/screens/DashboardScreen.tsx`）：产品/节点/会话/运行中指标、跨节点
  Dude、运行中会话。看板通过 `loadNodeOverview` 汇总每个节点，不要为汇总切换当前节点。
- 抽屉会话树：只展示有节点的产品，结构为产品 → 节点 → 会话分组 → 会话；Tron 使用
  主题 / 目录 / 随聊分组，其他产品为单层会话列表。树数据必须通过
  `NodeSession.requestForNode(node, …)` 按节点读取，不得为了读取树数据切换当前节点，也
  不得新增绕过 HTTPS/JWT 的请求路径。会话元数据仅缓存在内存中。
- 非 HTTPS 节点默认拒绝，且必须在发起任何请求前拦截；只有节点显式 `allowInsecure`
  且用户二次确认后才允许 `http://`。不要新增绕过该闸门的请求代码。
- 主题：`src/theme/`。移动端自有主题，绝不读取或同步节点皮肤；新增或修改界面必须使用
  `useTheme()` / `useThemedStyles(createStyles)`，不允许再引入静态 `colors`；`createStyles`
  工厂放在模块顶层以保持 memo 稳定。
- 语言：`src/i18n`。新增界面文案必须走 `useI18n()` 的 `t()` / `format()`（非组件模块用
  `translate()`），并在 `src/i18n/messages.ts` 补英文；不要把中文硬编码在 JSX 或参数里。
  语言偏好存 `@personai/language/v1`。
- 新增业务接口时：响应按 `{code,message,data}` 解析，成功 code 为 `SUCCESS` 或 `0`；
  工作区相关请求带 `workspaceCode` 查询参数。

## 命令

```bash
npm run typecheck
npx expo export --platform web
npx expo-doctor
```

提交前以上三条必须全部通过。不写单元测试；UI/流程验证以 Web 预览与后端联调为主。