# 自前のインターネットトンネル

<p align="center">
  <a href="self-hosted-tunnel.md">简体中文</a> · <a href="self-hosted-tunnel.en.md">English</a> · <b>日本語</b>
</p>

PersonAI Mobile は公共中継を提供しません。スマートフォンが PC の Wi-Fi 外にいるときは、Tron remote listener まで転送する HTTPS 入口を自分で用意する必要があります。

この資料では Cloudflare Tunnel、Tailscale、FRP、Caddy/Nginx の 4 方式を説明します。プロトコルと暗号化は[リモートアクセス技術資料](remote-access.ja.md)を参照してください。

## 仕組み

```text
Phone ──wss──▶ HTTPS 入口（TLS 終端）
                      │  HTTP + WebSocket Upgrade
                      ▼
              Tron remote listener 127.0.0.1:8081
```

プロキシの要件：

- `Host: <publicBaseUrl のホスト>` を保持する；
- WebSocket Upgrade を転送する；
- `X-Forwarded-Proto: https`（または同等の `Forwarded`）を設定する；
- Tron の remote listener に到達できる。

インターネット側 TLS は外側のみを保護します。TRP の内部には Noise エンドツーエンド暗号化があるため、プロキシは会話内容を読めません。

## 1. 先に Tron を設定

Tron の設定画面でリモートアクセスを有効にするか、設定ファイルを編集します。

```yaml
# ~/.tron/application.yaml (macOS/Linux)
remoteAccess:
  enabled: true
  port: 8081
  publicBaseUrl: https://tron.example.com
```

注意：

- `port` は remote listener のポートです。既定の `0` はメインポート + 1 を意味します。例では `8081` を使います。Expo などが 8081 を使っている場合は `18081` などの空きポートに変更してください。
- `publicBaseUrl` は `https://` で始まり、プロキシが使うドメインと一致する必要があります（非標準ポートなら URL にも含める）。
- 変更後は Tron を再起動してください。remote listener は起動時にバインドされます。
- `8081` を直接インターネットへ公開せず、HTTPS プロキシだけを公開してください。

確認：

```bash
curl http://127.0.0.1:8081/health
curl http://127.0.0.1:8080/api/v1/remote/service/pairing
```

`pairingUri` には `lan` と `public` の両方が含まれます。

## 2. Cloudflare Tunnel（グローバル IP 不要）

ドメインがあり、ルーターのポートを開けたくない場合に適しています。

一時テスト：

```bash
cloudflared tunnel --url http://127.0.0.1:8081
```

`https://xxx.trycloudflare.com` の URL が表示されます。これを `publicBaseUrl` に入れて外からペアリングできます。再起動で URL が変わるため、テスト用途のみです。

固定ドメイン：

```bash
cloudflared tunnel login
cloudflared tunnel create tron
cloudflared tunnel route dns tron tron.example.com
```

`~/.cloudflared/config.yml`：

```yaml
tunnel: <tunnel-uuid>
credentials-file: /Users/you/.cloudflared/<tunnel-uuid>.json
ingress:
  - hostname: tron.example.com
    service: http://127.0.0.1:8081
  - service: http_status:404
```

起動：

```bash
cloudflared tunnel run tron
```

Cloudflare が TLS を担当し、`X-Forwarded-Proto: https` を付けます。WebSocket も標準対応です。

## 3. Tailscale

PC とスマートフォンの両方が tailnet に参加している場合に適しています。

tailnet 内のみ：

```bash
tailscale serve --bg 8081
```

インターネットへ公開（HTTPS/Funnel の有効化が必要）：

```bash
tailscale funnel --bg 8081
```

表示される `https://<machine>.<tailnet>.ts.net` を `publicBaseUrl` に設定します。Tailscale はローカルでプロキシするため、Tron から見た接続元は loopback になり、信頼済みプロキシとして扱われます。

注意：

- `serve` は tailnet 内だけです。スマートフォンが tailnet にいない場合は `funnel` を使います。
- Funnel はインターネット入口です。デバイス失効とペアリングポリシーを適切に管理してください。

## 4. FRP

VPS とドメインがあり、経路を自分で管理したい場合に適しています。

### frps.toml（VPS）

```toml
bindPort = 7000
vhostHTTPSPort = 443
```

443 が使用中なら `8443` にし、`publicBaseUrl` を `https://tron.example.com:8443` にします。

### frpc.toml（PC、Tron と同じマシン）

```toml
serverAddr = "vps.example.com"
serverPort = 7000

[[proxies]]
name = "tron-remote"
type = "https"
customDomains = ["tron.example.com"]

[proxies.plugin]
type = "https2http"
localAddr = "127.0.0.1:8081"
crtPath = "/path/to/fullchain.pem"
keyPath = "/path/to/privkey.pem"
hostHeaderRewrite = "tron.example.com"
requestHeaders.set.X-Forwarded-Proto = "https"
```

ポイント：

- `localAddr` は Tron の remote listener を指す。
- `crtPath` / `keyPath` はそのドメインの証明書。`https2http` は frpc 側で TLS を終端する。
- `hostHeaderRewrite` は `publicBaseUrl` のホストと一致させる。Tron はインターネットからのリクエストの検証に使う。
- `X-Forwarded-Proto` を明示的に `https` にしないと Tron は 400 を返す。
- frpc と Tron は同じマシンなので接続元は loopback になり、信頼済みプロキシとして扱われる。

DNS：`tron.example.com` の A レコードを VPS に向け、VPS のファイアウォールで `7000` と `443` を開放します。

起動：

```bash
frps -c frps.toml
frpc -c frpc.toml
```

## 5. Caddy / Nginx（グローバル IP または既存リバースプロキシ）

### Caddy

```caddyfile
tron.example.com {
    reverse_proxy 127.0.0.1:8081
}
```

Caddy が証明書取得、WebSocket 転送、`X-Forwarded-Proto` 設定を自動で行います。

### Nginx

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name tron.example.com;

    ssl_certificate     /etc/letsencrypt/live/tron.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tron.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 3600s;
    }
}
```

リバースプロキシは Tron と同じマシンで動かしてください（接続元が loopback になる）。別マシンに置く場合は、プロキシの CIDR を Tron の `trustedProxies` に追加する必要があります。現時点で Tron にその UI はありません。

## 6. 検証

ローカルでインターネット側 Host を模擬：

```bash
curl -H 'Host: tron.example.com' \
     -H 'X-Forwarded-Proto: https' \
     http://127.0.0.1:8081/remote/identity
```

`nodeId`、`lanBaseUrl`、`publicBaseUrl` などが返れば成功です。

外から確認：

```bash
curl https://tron.example.com/health
curl https://tron.example.com/remote/identity
```

ペアリング QR には次が含まれます。

```text
lan=http://192.168.x.x:8081
public=https://tron.example.com
```

スマートフォンは自宅で LAN、外出先で public に自動切替します。

## 7. トラブルシューティング

| 現象 | 確認 |
| --- | --- |
| `400 Host does not match publicBaseUrl` | プロキシが Host を保持していない、または `publicBaseUrl` が違う |
| `400 public access requires HTTPS terminated by a trusted proxy` | `X-Forwarded-Proto: https` がない、または接続元が loopback/信頼済み CIDR でない |
| WebSocket 400 / すぐ切断 | プロキシが `Upgrade` / `Connection` を転送していない、またはタイムアウトが短い |
| 外から 502 | プロキシから `127.0.0.1:8081` に到達できない、または Tron のリモートアクセスが無効/未再起動 |
| QR に public がない | `publicBaseUrl` が空、または `https://` でない |
| 自宅でもインターネット経由になる | LAN が到達不能。ファイアウォール、ポート、QR の `lan` を確認 |
| 8081 が使用中 | `remoteAccess.port` を変更し、プロキシと `publicBaseUrl` も更新 |

## セキュリティ推奨事項

- 公開するのは HTTPS プロキシのポートだけ。remote listener を直接公開しない。
- 有効な証明書を使い、TLS 検証を無効化しない。
- Tron の設定画面でペアリング済みデバイスを定期的に確認し、不審なデバイスを失効させる。
- 入口自体は認証を提供しません。セキュリティはデバイス鍵と Noise ハンドシェイクに依存します。remote listener を直接インターネットに置かないでください。
