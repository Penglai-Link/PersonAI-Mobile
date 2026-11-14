# PersonAI Mobile

**Your AI workspace, in your pocket.**

<p align="center">
  <a href="README.md">简体中文</a> · <b>English</b> · <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-3B82F6?style=flat-square"></a>
  <img alt="Platforms: iOS, Android, iPad" src="https://img.shields.io/badge/platform-iOS%20%7C%20Android%20%7C%20iPad-111827?style=flat-square">
  <a href="https://expo.dev"><img alt="Expo SDK 58" src="https://img.shields.io/badge/Expo-SDK%2058-000020?style=flat-square&logo=expo&logoColor=white"></a>
  <a href="https://reactnative.dev"><img alt="React Native 0.88" src="https://img.shields.io/badge/React%20Native-0.88-61DAFB?style=flat-square&logo=react&logoColor=black"></a>
  <a href="https://github.com/Penglai-Link/PersonAI-Mobile/pulls"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-22C55E?style=flat-square"></a>
</p>

PersonAI Mobile is the open-source mobile client for the Person-AI ecosystem. It connects the AI
services on your computers and home servers, treating each machine as a node. See the status of
every node on one dashboard, swipe out the menu to switch products, and pick up a conversation
where you left off. The app connects directly to your nodes: chat history is never written to the
phone and never passes through a third-party relay.

<p align="center">
  <img src="docs/screenshots/dashboard.png" width="220" alt="Cross-node dashboard">
  <img src="docs/screenshots/drawer-session-tree.png" width="220" alt="Side menu organized by product, node, and session">
  <img src="docs/screenshots/chat-dude.png" width="220" alt="Streaming conversation with a Dude">
</p>
<p align="center"><sub>Cross-node dashboard · products, nodes, and sessions · a conversation with a Dude (Chinese UI, demo data)</sub></p>

## Why this exists

Desktop tools execute work; a phone keeps you reachable. Away from your desk, you may want to know
which machine is still running a task, whether a Dude has returned a result, or send one more
instruction to a remote node. Opening a laptop, connecting a VPN, and finding the right window is
too much effort for that.

PersonAI Mobile is not a smaller desktop client. It keeps the three things that matter on the move:
a clear overview, fast switching, and conversations you can continue. Execution, files, and tool
calls stay on your computer; the phone starts work and shows the results.

## What it does

### One dashboard for every node

Home collects every product and node: product count, online nodes, total sessions, running tasks,
and Dude cards from different nodes. The app connects to a node and opens the chat only when you
tap a Dude or a running session. The dashboard only aggregates; it never changes the node you are
working with just to load data.

No need to choose a computer first, and one offline machine does not hide the others.

### Swipe from the left edge to open your sessions

On any screen, swipe right from the left edge to open the side menu. It is organized by product,
node, and session:

```text
Product
└── Node
    └── Session group
        └── Session
```

- Tron Harness splits sessions into Topics, Directories, and Chats. Other products have a single
  session list.
- Multiple computers under one product are listed together; you do not choose one in advance.
- Sessions load on demand and stay in memory. Reopening the menu refreshes them; switching nodes
  or going offline clears them.
- Pairing by QR and Settings stay in the top-right corner of the menu.

### Replies that appear as they are written

Chat replies stream in as they are generated. When the current environment cannot read a stream,
the app falls back to a regular request and polls for the result, and the screen tells you which
mode is active. The input supports multiple lines, with clear feedback for sending, retry, and
offline states.

The interface uses native components rather than a web wrapper, so long lists and the keyboard
behave like a system app.

### Secure by default

| Data | Stored in | Kept until |
| --- | --- | --- |
| Pairing credentials | Secure storage on the phone, per computer | The node is removed or paired again |
| Access token | Memory only | Expires, or is cleared when you switch nodes, background the app, or go offline |
| Sessions and messages | Memory only | The app exits |
| Products, nodes, and preferences | Local storage on the phone | Persisted |

- Remote connections require HTTPS by default. A node that uses `http://` must be marked for
  insecure debugging and confirmed again; otherwise the app sends no request at all.
- When an access token expires, the app fetches a new one once. If that fails, it asks you to pair
  again.
- A lost phone holds no reusable access credentials and no readable chat history.

### Designed for the phone

Four accent themes, light, dark, and system appearance, and a Simplified Chinese or English
interface. Themes belong to the phone and never follow a computer's skin. Language changes apply
immediately and are saved on the device.

<p align="center">
  <img src="docs/screenshots/settings.png" width="230" alt="Theme, language, and product settings">
  <img src="docs/screenshots/dashboard-light.png" width="230" alt="Dashboard in light mode">
</p>
<p align="center"><sub>Themes, language, and product definitions · light mode (Chinese UI, demo data)</sub></p>

### Built-in products, plus your own

Built-in products work out of the box, and you can add your own product code in Settings. Pair a
node by scanning its QR code or entering the details by hand. The app trusts the product identity
reported by the node; if it differs from the current product, the node is moved to the right
product and you are told.

| Product | Code | On the phone |
| --- | --- | --- |
| Tron Harness | `tron` | Topics, directories, and chats; Dudes; workspaces; streaming sessions |
| 运维智能体 (Ops Agent) | `axiom-agent` | Sessions, workspaces, and Dude summaries |
| 小说智能体 (Novel Agent) | `novel-agent` | Sessions, workspaces, and Dude summaries |
| GitDeck | `git-deck` | Sessions, workspaces, and Dude summaries |
| Custom product | Lowercase letters, digits, `.` or `-` | One session list; add or remove at any time |

Built-in products cannot be removed. Removing a custom product also removes its nodes and pairing
credentials.

## Who it is for

- People who run different AI services on several computers or home servers and want one place to
  manage them.
- People who leave their desk but still want to check on work and continue a conversation.
- People who care about data boundaries and do not want chat history going through a third-party
  cloud.
- Teams extending the Person-AI protocol with their own mobile entry point.

## Getting started

PersonAI Mobile is in early preview; installers and store distribution are still in progress. To
try it:

1. Start a Person-AI service on your computer and enable remote access.
2. Install PersonAI Mobile on your phone. Only development builds are available for now.
3. Tap the scan icon in the top-right corner of the side menu and scan the QR code on your
   computer. You can also enter the address and pairing token by hand.

See the [developer guide](DEVELOPMENT.en.md) for installation, builds, and local development.

## Known limitations

- Early preview: physical-device validation and store distribution are not complete.
- The session tree reads only the first active workspace on each computer.
- Messages are plain text. Markdown and attachments are not supported yet.
- Insecure debugging cannot be turned off on its own; remove the node and pair it again.
- The web preview is for debugging only, not a supported production environment.

## Contributing

Issues and pull requests are welcome. Read the [developer guide](DEVELOPMENT.en.md) and
[AGENTS.md](AGENTS.md) before you start. Changes to networking, session storage, or navigation
gestures should explain the security boundary and how you verified it in the PR.

If this project is useful to you, a star helps others find it.

## License

[GNU Affero General Public License v3.0](LICENSE) © Person-AI

PersonAI Mobile is free software: you can use, modify, and distribute it. If you provide it as a
network service, the AGPL requires you to publish the corresponding source code.

---

[Developer guide](DEVELOPMENT.en.md) · [简体中文](README.md) · [日本語](README.ja.md) · [AGPL-3.0](LICENSE)