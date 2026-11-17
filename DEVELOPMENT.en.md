# Developer guide

<p align="center">
  <a href="DEVELOPMENT.md">简体中文</a> · <b>English</b> · <a href="DEVELOPMENT.ja.md">日本語</a>
</p>

This guide is for developers who want to run, build, or extend PersonAI Mobile from source. For
the product overview, see [README](README.en.md).

## Requirements

- Node.js 22.13+ (22, 24, or 26 series), with 24 LTS recommended.
- npm; the repository uses `package-lock.json`.
- Expo Go or a development build for previews.
- EAS CLI for native builds. EAS builds do not require a full local Xcode or Android SDK.

## Run locally

```bash
git clone https://github.com/Penglai-Link/PersonAI-Mobile.git
cd PersonAI-Mobile
npm install
npm run start
```

Open the project with Expo Go or a development build when the terminal prompts you. Common
scripts:

```bash
npm run web             # Browser preview
npm run typecheck       # tsc --noEmit
npm run export:web      # Export the web build
```

## Native builds

Use EAS Build. Do not hand-write or commit generated `ios/` and `android/` directories:

```bash
npx eas-cli build --platform ios --profile preview
npx eas-cli build --platform android --profile preview
```

The `preview` profile produces internal builds: an APK for Android and a simulator build for iOS.
Use `--profile production` for store distribution. Sign in to your Expo account first; the EAS
`projectId` is already configured in `app.json`.

## Checks

All three commands must pass before you commit:

```bash
npm run typecheck
npx expo export --platform web
npx expo-doctor
```

The repository has no unit tests. Verify UI and flows in the web preview and against a backend.
Changes to networking, the security gate, or the session lifecycle also need notes on how you
verified them by hand.

## Project layout

```text
src/
  screens/       Dashboard, nodes, chat, settings
  navigation/    Native stack and the custom side menu
  store/         Product and node metadata, JWT and session lifecycle
  api/           HTTP, SSE, and response normalization
  theme/         Built-in themes and palettes
  i18n/          Chinese source strings and English translations
  components/    Shared cards, badges, and message bubbles
```

Key files:

| File | Responsibility |
| --- | --- |
| `src/store/connections.tsx` | Products, nodes, pairing tokens, and online state |
| `src/store/nodeSession.tsx` | JWT exchange, 401 refresh, offline state, HTTPS gate |
| `src/screens/DashboardScreen.tsx` | Cross-node dashboard |
| `src/navigation/Drawer.tsx` | Left-edge gesture and side menu shell |
| `src/navigation/DrawerTree.tsx` | Product → node → session tree |
| `src/utils/nodeOverview.ts` | Per-node workspaces, PersonAI, and sessions |
| `src/i18n/messages.ts` | UI strings and English translations |
| `app.json` / `eas.json` | Expo app and build configuration |

## Architecture rules

See [AGENTS.md](AGENTS.md) for the complete rules. These are the boundaries most changes run into.

### Navigation

- Use `@react-navigation/native` with native-stack, not Expo Router.
- The top-level menu is custom. Do not add a drawer dependency that requires a native rebuild.
- Keep `gestureEnabled: false` on the native stack so the left-edge gesture belongs to the menu.
- Go back with the `AppHeader` back button, not the system swipe-back gesture.
- Manage themes, language, and product definitions in Settings. Do not add another entry point
  elsewhere.

### Requests and security

- Every remote request must go through `NodeSession.request`, or call `ensureAccessToken()` first.
- Non-HTTPS nodes are rejected by default, before any request is sent. Allow `http://` only when
  the node is explicitly marked `allowInsecure` and the user has confirmed a second time. Do not
  add a request path that bypasses this gate.
- Keep the JWT in memory only. On 401, exchange the pairing token once more; if that fails, mark
  the node offline.
- Store pairing tokens only in `expo-secure-store`. The web preview falls back to AsyncStorage for
  debugging only.
- **Never** write the JWT, session lists, messages, or chat history to AsyncStorage or
  SecureStore.

### Session lifecycle

- Clear the in-memory JWT and session content when the active node changes, the app goes to the
  background, or the node goes offline.
- The dashboard aggregates nodes through `loadNodeOverview`. Do not switch the active node just to
  load summary data.
- The session tree reads each node through `NodeSession.requestForNode`. Do not switch the active
  node to load tree data.
- Keep session metadata in memory only.

### Theme and i18n

- Use `useTheme()` and `useThemedStyles(createStyles)`. Do not introduce static `colors`.
- Define `createStyles` at module scope to keep memoization stable.
- Route new copy through `useI18n()`'s `t()` / `format()`, or `translate()` outside components,
  and add the English string in `src/i18n/messages.ts`.
- Never hard-code Chinese in JSX or arguments.

### API

- Parse responses as `{ code, message, data }`; success codes are `SUCCESS` or `0`.
- Send `workspaceCode` on workspace-scoped requests. The first workspace-list request is the
  exception.
- Normalize new API responses in `src/api/tron.ts`. Do not pass unchecked JSON to the UI.

## Pairing and backend contract

<details>
<summary>Pairing QR format and endpoints used by the app</summary>

v2 (current desktop format):

```text
tron://pair?v=2&url=<urlencoded baseUrl>&token=<token>&name=<urlencoded machineName>&product=tron&productName=Tron&node=<nodeId>&secure=1
```

v1 supports older desktops. When `product`, `node`, or `secure` is missing, the app treats the
node as Tron and infers `secure` from the URL scheme:

```text
tron://pair?v=1&url=<urlencoded baseUrl>&token=<token>&name=<urlencoded machineName>
```

Endpoints used by the app:

- `POST /api/v1/remote/session`: `Authorization: Bearer <pairingToken>`, returns
  `{ accessToken, expiresIn, identity }`.
- `GET /api/v1/remote/identity`: JWT-authenticated identity.
- `GET /api/v1/health`: unauthenticated online probe.
- `GET /api/v1/admin/workspaces/options`: workspace list.
- `GET /api/v1/chats/session-groups`, `GET /api/v1/assistants`: sessions and PersonAI.
- `POST /api/v1/projects/list`, `GET /api/v1/directories`: projects and directories for Tron's Topics and Directories groups.
- `POST /api/v1/chats/sessions`: create a chat session.
- `POST /api/v1/assistants/main/session`, `POST /api/v1/assistants/{assistantCode}/sessions`: create PersonAI sessions.
- `GET/POST /api/v1/chats/sessions/{sessionCode}/messages`: read messages and send without
  streaming.
- `POST /api/v1/chats/sessions/{sessionCode}/messages/stream`: SSE streaming replies.

The complete contract lives in the Tron repository at
`tron-backend/src/adapters/inbound/http/remote_access.rs` and in its backend README.

</details>

## Web preview

The web preview is for debugging and bundle verification, not a supported secure target:

- Browsers have no SecureStore, so pairing tokens fall back to AsyncStorage.
- SSE, camera, and keyboard behavior differ from native. Recheck those flows on a device or
  development build.
- After every change, run at least `npm run typecheck` and `npx expo export --platform web`.

## Known technical limits

- The session tree reads only the first ACTIVE workspace on each node; multi-workspace nodes are
  not merged.
- Messages render as plain text. Markdown and attachments are not handled.
- The insecure-debug flag cannot be revoked on its own; remove the node and pair it again.
- Physical-device validation and store distribution are not complete.
- The repository has no unit tests; regressions rely on type checks and manual flow verification.

## Contributing

- Read [AGENTS.md](AGENTS.md) first.
- Run `npm run typecheck`, `npx expo export --platform web`, and `npx expo-doctor` before
  committing.
- Describe the scope, security boundary, and verification in your pull request.
- Add English copy when you add UI text, and reuse `src/components` before creating a new
  component.

---

[Product overview](README.en.md) · [简体中文](DEVELOPMENT.md) · [日本語](DEVELOPMENT.ja.md)