# PersonAI-Mobile

PersonAI Mobile 的 Expo + React Native 移动端，目录与 Tron 主仓库同级。只允许修改本目录。
后端契约以 `../Tron/tron-backend/src/adapters/inbound/http/remote_access.rs` 与 README 为准。

## 技术栈

- Expo SDK 58、React Native 0.88、React 19、TypeScript 6。
- 导航使用 `@react-navigation/native` + native-stack，不使用 Expo Router。
- 网络/SSE 使用 `expo/fetch`；流式不可用时降级为普通 POST + 轮询。
- 本机没有完整 Xcode / Android SDK。需要原生包时使用 EAS Build，不要手写 `ios/` 或 `android/`。

## 架构约束

- 产品与节点：`src/store/connections.tsx`。产品/节点元数据存 AsyncStorage
  （`@personai/products/v1`、`@personai/nodes/v1`；启动时兼容迁移旧 `@tron/*`），内置产品编码固定为 `tron` 且不可删除。
- 每节点配对令牌存 `expo-secure-store`（键 `personai.token.<nodeId>`；旧 `tron.token.*` 会在读取时迁移）。Web 预览没有
  SecureStore，退化为 AsyncStorage（`@personai/secure-token/*`），仅用于调试。
- JWT 会话：`src/store/nodeSession.tsx`。JWT 只放内存；401 自动用配对令牌重新换取一次；
  切换节点、App 进入后台、离线时清空内存会话与会话内容。
- **禁止**把 JWT、会话列表、消息、聊天历史写入 AsyncStorage 或 SecureStore。
- 所有远程请求必须经过 `NodeSession.request` 或先 `ensureAccessToken()`，以统一处理
  JWT、401 刷新、离线判定与 HTTPS 闸门。
- 非 HTTPS 节点默认拒绝，且必须在发起任何请求前拦截；只有节点显式 `allowInsecure`
  且用户二次确认后才允许 `http://`。不要新增绕过该闸门的请求代码。
- 主题：`src/theme/`。新增或修改界面必须使用 `useTheme()` / `useThemedStyles(createStyles)`，
  不允许再引入静态 `colors`；`createStyles` 工厂放在模块顶层以保持 memo 稳定。
- 新增业务接口时：响应按 `{code,message,data}` 解析，成功 code 为 `SUCCESS` 或 `0`；
  工作区相关请求带 `workspaceCode` 查询参数。

## 命令

```bash
npm run typecheck
npx expo export --platform web
npx expo-doctor
```

提交前以上三条必须全部通过。不写单元测试；UI/流程验证以 Web 预览与后端联调为主。