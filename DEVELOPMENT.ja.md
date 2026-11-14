# 開発ガイド

<p align="center">
  <a href="DEVELOPMENT.md">简体中文</a> · <a href="DEVELOPMENT.en.md">English</a> · <b>日本語</b>
</p>

このガイドは、PersonAI Mobile をソースから実行、ビルド、拡張する開発者向けです。製品概要は
[README](README.ja.md) を参照してください。

## 必要な環境

- Node.js 22.13+（22 / 24 / 26 系）、24 LTS を推奨。
- npm。リポジトリは `package-lock.json` を使用します。
- プレビュー用の Expo Go または開発ビルド。
- ネイティブビルドには EAS CLI。EAS ビルドに完全な Xcode / Android SDK は不要です。

## ローカルで実行

```bash
git clone https://github.com/Penglai-Link/PersonAI-Mobile.git
cd PersonAI-Mobile
npm install
npm run start
```

ターミナルの案内に従い、Expo Go または開発ビルドで開きます。よく使うスクリプト：

```bash
npm run web             # ブラウザプレビュー
npm run typecheck       # tsc --noEmit
npm run export:web      # Web ビルドのエクスポート
```

## ネイティブビルド

EAS Build を使用します。生成された `ios/` と `android/` を手書きしたりコミットしたりしないで
ください。

```bash
npx eas-cli build --platform ios --profile preview
npx eas-cli build --platform android --profile preview
```

`preview` は内部テスト用のビルドを作ります。Android は APK、iOS はシミュレータ用です。ストア
配布には `--profile production` を使用します。事前に Expo アカウントへログインしてください。
EAS の `projectId` は `app.json` に設定済みです。

## チェック

コミット前に次の三つをすべて通してください。

```bash
npm run typecheck
npx expo export --platform web
npx expo-doctor
```

リポジトリに単体テストはありません。UI とフローは Web プレビューおよびバックエンド接続で
確認します。ネットワーク、セキュリティゲート、セッションライフサイクルに関わる変更では、
手動検証の手順も記載してください。

## プロジェクト構成

```text
src/
  screens/       ダッシュボード、ノード、チャット、設定
  navigation/    ネイティブスタックと自前のサイドメニュー
  store/         プロダクト / ノードのメタデータ、JWT、セッションライフサイクル
  api/           HTTP、SSE、レスポンスの正規化
  theme/         組み込みテーマとパレット
  i18n/          中国語のソース文言と英語翻訳
  components/    カード、バッジ、メッセージバブルなどの共通部品
```

主要ファイル：

| ファイル | 役割 |
| --- | --- |
| `src/store/connections.tsx` | プロダクト、ノード、ペアリングトークン、オンライン状態 |
| `src/store/nodeSession.tsx` | JWT 取得、401 更新、オフライン判定、HTTPS ゲート |
| `src/screens/DashboardScreen.tsx` | ノードをまたぐダッシュボード |
| `src/navigation/Drawer.tsx` | 左端ジェスチャーとサイドメニュー |
| `src/navigation/DrawerTree.tsx` | プロダクト → ノード → セッションのツリー |
| `src/utils/nodeOverview.ts` | ノードごとのワークスペース、Dude、セッション |
| `src/i18n/messages.ts` | UI 文言と英語翻訳 |
| `app.json` / `eas.json` | Expo アプリとビルドの設定 |

## アーキテクチャの制約

完全なルールは [AGENTS.md](AGENTS.md) を参照してください。変更時によく関係する境界は次の
とおりです。

### ナビゲーション

- `@react-navigation/native` と native-stack を使用し、Expo Router は使用しません。
- トップメニューは自前実装です。ネイティブ再ビルドが必要な drawer 依存を追加しないで
  ください。
- ネイティブスタックは `gestureEnabled: false` を維持し、左端ジェスチャーをメニュー専用に
  します。
- 戻る操作は `AppHeader` の戻るボタンを使い、システムのスワイプ戻りに依存しません。
- テーマ、言語、プロダクト定義は設定画面に集約します。

### リクエストとセキュリティ

- すべてのリモートリクエストは `NodeSession.request` を経由するか、先に
  `ensureAccessToken()` を呼びます。
- 非 HTTPS ノードは既定で拒否し、リクエスト送信前にブロックします。`allowInsecure` が
  明示され、ユーザーが再確認した場合だけ `http://` を許可します。ゲートを迂回する経路を
  追加しないでください。
- JWT はメモリにだけ保持します。401 ではペアリングトークンで一度だけ再取得し、失敗したら
  オフラインにします。
- ペアリングトークンは `expo-secure-store` にだけ保存します。Web プレビューはデバッグ用に
  AsyncStorage へフォールバックします。
- JWT、セッション一覧、メッセージ、チャット履歴を AsyncStorage / SecureStore に
  **書き込まないでください**。

### セッションのライフサイクル

- ノード切り替え、アプリのバックグラウンド移行、オフライン時に、メモリ上の JWT と
  セッション内容を消去します。
- ダッシュボードは `loadNodeOverview` で各ノードを集計します。集計のために使用中ノードを
  切り替えないでください。
- セッションツリーは `NodeSession.requestForNode` でノードごとに読み込みます。ツリー表示の
  ために使用中ノードを切り替えないでください。
- セッションメタデータはメモリにだけ保持します。

### テーマと国際化

- `useTheme()` / `useThemedStyles(createStyles)` を使い、静的 `colors` を導入しません。
- `createStyles` はモジュール先頭に定義し、memo を安定させます。
- 新しい文言は `useI18n()` の `t()` / `format()`（コンポーネント外では `translate()`）を
  通し、`src/i18n/messages.ts` に英語を追加します。
- JSX や引数に中国語を直書きしません。

### API

- レスポンスは `{ code, message, data }` として解析し、成功コードは `SUCCESS` または `0`
  です。
- ワークスペース関連のリクエストには `workspaceCode` を付けます。最初のワークスペース
  一覧取得だけは例外です。
- 新しい API レスポンスは `src/api/tron.ts` で正規化します。検証していない JSON を UI に
  渡さないでください。

## ペアリングとバックエンド契約

<details>
<summary>ペアリング QR 形式とアプリが使用するエンドポイント</summary>

v2（現在のデスクトップ形式）：

```text
tron://pair?v=2&url=<urlencoded baseUrl>&token=<token>&name=<urlencoded machineName>&product=tron&productName=Tron&node=<nodeId>&secure=1
```

v1 は旧デスクトップ向けです。`product` / `node` / `secure` がない場合、アプリは Tron
プロダクトとして扱い、`secure` は URL スキームから推定します：

```text
tron://pair?v=1&url=<urlencoded baseUrl>&token=<token>&name=<urlencoded machineName>
```

アプリが使用するエンドポイント：

- `POST /api/v1/remote/session`：`Authorization: Bearer <pairingToken>` で
  `{ accessToken, expiresIn, identity }` を取得。
- `GET /api/v1/remote/identity`：JWT 認証でノードの identity を取得。
- `GET /api/v1/health`：認証不要のオンライン確認。
- `GET /api/v1/admin/workspaces/options`：ワークスペース一覧。
- `GET /api/v1/chats/session-groups`、`GET /api/v1/dudes`：セッションと Dude。
- `POST /api/v1/projects/list`、`GET /api/v1/directories`：Tron のトピックとディレクトリのグループに使うプロジェクト / ディレクトリ一覧。
- `POST /api/v1/chats/sessions`：チャットセッションの作成。
- `POST /api/v1/dudes/main/session`、`POST /api/v1/dudes/{dudeCode}/sessions`：Dude セッションの作成。
- `GET/POST /api/v1/chats/sessions/{sessionCode}/messages`：メッセージ取得と通常送信。
- `POST /api/v1/chats/sessions/{sessionCode}/messages/stream`：SSE ストリーミング応答。

完全な契約は Tron リポジトリの
`tron-backend/src/adapters/inbound/http/remote_access.rs` とバックエンドの README を
参照してください。

</details>

## Web プレビュー

Web プレビューはデバッグとバンドル確認用で、正式な安全利用の対象ではありません。

- ブラウザに SecureStore はないため、ペアリングトークンは AsyncStorage にフォールバック
  します。
- SSE、カメラ、キーボードの挙動はネイティブと異なります。これらのフローは実機または開発
  ビルドで再確認してください。
- 変更後は最低限 `npm run typecheck` と `npx expo export --platform web` を実行します。

## 既知の技術制限

- セッションツリーは各ノードの最初の ACTIVE ワークスペースだけを読み込みます。複数
  ワークスペースのノードは統合表示されません。
- メッセージはプレーンテキストで描画し、Markdown と添付ファイルは処理しません。
- 「安全でないデバッグ」は個別に解除できません。ノードを削除して再ペアリングしてください。
- 実機検証とストア配布は完了していません。
- リポジトリに単体テストはなく、回帰確認は型チェックと手動フローに依存します。

## コントリビューション

- 開始前に [AGENTS.md](AGENTS.md) を読んでください。
- コミット前に `npm run typecheck`、`npx expo export --platform web`、
  `npx expo-doctor` を通してください。
- PR には変更範囲、セキュリティ境界、検証方法を記載してください。
- UI 文言を追加するときは英語も追加し、新しいコンポーネントより `src/components` の再利用を
  優先してください。

---

[製品概要](README.ja.md) · [简体中文](DEVELOPMENT.md) · [English](DEVELOPMENT.en.md)