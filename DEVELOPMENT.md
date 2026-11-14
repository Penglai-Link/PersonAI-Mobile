# 开发文档

<p align="center">
  <b>简体中文</b> · <a href="DEVELOPMENT.en.md">English</a> · <a href="DEVELOPMENT.ja.md">日本語</a>
</p>

本文件面向从源码运行、构建或扩展 PersonAI Mobile 的开发者。产品介绍和功能概览见
[README](README.md)。

## 环境要求

- Node.js 22.13+（支持 22 / 24 / 26 系列），建议使用 24 LTS。
- npm，仓库使用 `package-lock.json`。
- 用于预览的 Expo Go，或自建开发构建。
- 构建原生包时需要 EAS CLI；只做 Web 预览或 JS 开发不需要完整的 Xcode / Android SDK。

## 获取与运行

```bash
git clone https://github.com/Penglai-Link/PersonAI-Mobile.git
cd PersonAI-Mobile
npm install
npm run start
```

启动后按终端提示，用 Expo Go 或开发构建打开。常用脚本：

```bash
npm run web             # 浏览器预览
npm run typecheck       # tsc --noEmit
npm run export:web      # 导出 Web 构建
```

## 构建原生包

仓库使用 EAS Build。不要手写或提交生成的 `ios/`、`android/` 目录：

```bash
npx eas-cli build --platform ios --profile preview
npx eas-cli build --platform android --profile preview
```

`preview` 生成内部测试包：Android 使用 APK，iOS 使用模拟器构建。正式分发改用
`--profile production`。构建前需要登录 Expo 账号，`app.json` 中的 EAS `projectId` 已配置。

## 检查

提交前以下三条必须全部通过：

```bash
npm run typecheck
npx expo export --platform web
npx expo-doctor
```

仓库不写单元测试。UI 与流程验证以 Web 预览和后端联调为主；涉及网络、安全闸门或会话生命
周期的改动，还需要说明手工验证的路径。

## 项目结构

```text
src/
  screens/       看板、节点、聊天、设置
  navigation/    原生栈与自绘侧滑菜单
  store/         产品 / 节点元数据、JWT 与会话生命周期
  api/           HTTP、SSE 与响应归一化
  theme/         内置主题与调色板
  i18n/          中文源文案与英文翻译
  components/    卡片、徽标、消息气泡等共享组件
```

关键文件：

| 文件 | 职责 |
| --- | --- |
| `src/store/connections.tsx` | 产品、节点、配对令牌与在线状态 |
| `src/store/nodeSession.tsx` | JWT 换取、401 刷新、离线判定、HTTPS 闸门 |
| `src/screens/DashboardScreen.tsx` | 跨节点看板 |
| `src/navigation/Drawer.tsx` | 左缘手势与侧滑菜单外壳 |
| `src/navigation/DrawerTree.tsx` | 产品 → 节点 → 会话树 |
| `src/utils/nodeOverview.ts` | 按节点读取工作区、Dude 与会话 |
| `src/i18n/messages.ts` | 界面文案与英文翻译 |
| `app.json` / `eas.json` | Expo 应用配置与构建配置 |

## 架构约束

完整规则见 [AGENTS.md](AGENTS.md)。以下是改动时最容易踩到的边界。

### 导航

- 使用 `@react-navigation/native` + native-stack，不使用 Expo Router。
- 顶层菜单是自绘的，不引入需要原生重建的 drawer 依赖。
- 原生栈保持 `gestureEnabled: false`，左缘手势只用于打开菜单。
- 返回统一使用 `AppHeader` 的返回按钮，不依赖系统侧滑返回。
- 设置页集中管理主题、语言和产品定义，不要在其它页面另开入口。

### 请求与安全

- 所有远程请求必须经过 `NodeSession.request`，或先调用 `ensureAccessToken()`。
- 非 HTTPS 节点默认拒绝，并且在发出任何请求前拦截；只有节点显式设置 `allowInsecure`
  且用户二次确认后才允许 `http://`。不要新增绕过闸门的请求路径。
- JWT 只保存在内存。401 时用配对令牌重新换取一次，再失败则标记离线。
- 配对令牌只保存在 `expo-secure-store`（Web 预览退化为 AsyncStorage，仅用于调试）。
- **禁止**把 JWT、会话列表、消息或聊天历史写入 AsyncStorage / SecureStore。

### 会话生命周期

- 切换节点、App 进入后台或离线时，清空内存中的 JWT 和会话内容。
- 看板通过 `loadNodeOverview` 汇总每个节点，不得为了汇总切换当前节点。
- 会话树通过 `NodeSession.requestForNode` 按节点读取，不得为了读取树数据切换当前节点。
- 会话元数据只缓存在内存。

### 主题与国际化

- 界面必须使用 `useTheme()` / `useThemedStyles(createStyles)`，不引入静态 `colors`。
- `createStyles` 工厂放在模块顶层，保持 memo 稳定。
- 新增文案必须通过 `useI18n()` 的 `t()` / `format()`（非组件模块用 `translate()`），并在
  `src/i18n/messages.ts` 补英文。
- 不要把中文硬编码在 JSX 或参数里。

### 接口

- 响应统一按 `{ code, message, data }` 解析，成功 code 为 `SUCCESS` 或 `0`。
- 工作区相关请求携带 `workspaceCode` 查询参数；第一次拉取工作区列表时除外。
- 新产品接口沿用 `src/api/tron.ts` 的归一化方式，不要把未校验的 JSON 直接交给界面。

## 配对与后端契约

<details>
<summary>配对二维码格式与移动端使用的接口</summary>

v2（推荐，桌面端当前格式）：

```text
tron://pair?v=2&url=<urlencoded baseUrl>&token=<token>&name=<urlencoded machineName>&product=tron&productName=Tron&node=<nodeId>&secure=1
```

v1 兼容旧桌面端。缺少 `product` / `node` / `secure` 时按 Tron 产品处理，`secure` 由 URL
scheme 推断：

```text
tron://pair?v=1&url=<urlencoded baseUrl>&token=<token>&name=<urlencoded machineName>
```

移动端使用的接口：

- `POST /api/v1/remote/session`：`Authorization: Bearer <pairingToken>`，换取
  `{ accessToken, expiresIn, identity }`。
- `GET /api/v1/remote/identity`：JWT 认证，返回节点 identity。
- `GET /api/v1/health`：无需认证，用于在线探测。
- `GET /api/v1/admin/workspaces/options`：工作区列表。
- `GET /api/v1/chats/session-groups`、`GET /api/v1/dudes`：会话与 Dude。
- `POST /api/v1/projects/list`、`GET /api/v1/directories`：项目与目录列表，用于 Tron 的主题和目录分组。
- `POST /api/v1/chats/sessions`：新建会话。
- `POST /api/v1/dudes/main/session`、`POST /api/v1/dudes/{dudeCode}/sessions`：创建 Dude 会话。
- `GET/POST /api/v1/chats/sessions/{sessionCode}/messages`：消息读取与普通发送。
- `POST /api/v1/chats/sessions/{sessionCode}/messages/stream`：SSE 流式回复。

完整契约以 Tron 主仓库的
`tron-backend/src/adapters/inbound/http/remote_access.rs` 与后端 README 为准。

</details>

## Web 预览说明

Web 预览用于调试和打包验证，不是正式的安全使用方式：

- 浏览器没有 SecureStore 实现，配对令牌会退化为 AsyncStorage。
- 浏览器对 SSE、相机和键盘的处理与原生端不同，相关流程必须在真机或开发构建中复核。
- 每次修改后至少执行 `npm run typecheck` 和 `npx expo export --platform web`。

## 已知技术限制

- 会话树只读取每个节点的第一个 ACTIVE 工作区，多工作区节点不会合并展示。
- 消息按纯文本渲染，不处理 Markdown 和附件。
- 节点的“不安全调试”标记保存后不能单独撤销，需要删除节点后重新配对。
- 真机验证与商店分发尚未完成。
- 仓库没有单元测试，回归依赖类型检查和手工流程验证。

## 提交与贡献

- 开始前阅读 [AGENTS.md](AGENTS.md)。
- 提交前通过 `npm run typecheck`、`npx expo export --platform web` 和 `npx expo-doctor`。
- PR 说明改动范围、安全边界和验证方式。
- 新增界面文案时同时补英文翻译；新增组件时优先复用 `src/components`。

---

[产品介绍](README.md) · [English](DEVELOPMENT.en.md) · [日本語](DEVELOPMENT.ja.md)