# 自建公网隧道

<p align="center">
  <b>简体中文</b> · <a href="self-hosted-tunnel.en.md">English</a> · <a href="self-hosted-tunnel.ja.md">日本語</a>
</p>

PersonAI Mobile 不提供公共中转。电脑不在同一 Wi-Fi 时，需要你自建一个 HTTPS 入口，把手机流量转发到电脑上的 Tron remote listener。

本文给出 Cloudflare Tunnel、Tailscale、FRP、Caddy/Nginx 四种做法。协议与加密细节见[远程访问技术说明](remote-access.md)。

## 原理

```text
Phone ──wss──▶ HTTPS 入口（TLS 终止）
                      │  HTTP + WebSocket Upgrade
                      ▼
              Tron remote listener 127.0.0.1:8081
```

代理必须：

- 保留 `Host: <publicBaseUrl 的域名>`；
- 转发 WebSocket Upgrade；
- 设置 `X-Forwarded-Proto: https`（或等价的 `Forwarded`）；
- 能访问 Tron 的 remote listener。

公网 TLS 只保护外层；TRP 内部还有 Noise 端到端加密，代理无法读取会话内容。

## 一、先配置 Tron

在 Tron 设置页开启远程访问，或用配置文件：

```yaml
# ~/.tron/application.yaml（macOS/Linux）
remoteAccess:
  enabled: true
  port: 8081
  publicBaseUrl: https://tron.example.com
```

说明：

- `port` 是 remote listener 端口，默认 `0` 表示主端口 + 1；示例使用 `8081`。如果 8081 被 Expo 等开发工具占用，改成 `18081` 等空闲端口。
- `publicBaseUrl` 必须是 `https://`，并且和代理实际使用的域名一致（含端口时也要写进 URL）。
- 修改后重启 Tron；remote listener 只在启动时绑定。
- 不要把 `8081` 直接暴露到公网，只暴露 HTTPS 代理。

启动后检查：

```bash
curl http://127.0.0.1:8081/health
curl http://127.0.0.1:8080/api/v1/remote/service/pairing
```

配对接口返回的 `pairingUri` 会包含 `lan` 和 `public` 两个地址。

## 二、Cloudflare Tunnel（不需要公网 IP）

适合有域名、不想开路由器端口的情况。

临时测试：

```bash
cloudflared tunnel --url http://127.0.0.1:8081
```

它会给出一个 `https://xxx.trycloudflare.com` 地址。把该地址写入 `publicBaseUrl` 后，手机可在外网配对。临时地址每次重启会变，只适合测试。

固定域名：

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

启动：

```bash
cloudflared tunnel run tron
```

Cloudflare 负责 TLS，并会带上 `X-Forwarded-Proto: https`；WebSocket 原生支持。

## 三、Tailscale

适合电脑和手机都在 Tailscale 网络里的情况。

只给 tailnet 内设备：

```bash
tailscale serve --bg 8081
```

对公网开放（需要开启 HTTPS/Funnel 权限）：

```bash
tailscale funnel --bg 8081
```

拿到 `https://<machine>.<tailnet>.ts.net` 地址后写入 `publicBaseUrl`。Tailscale 在本机做代理，Tron 看到的来源是 loopback，属于可信代理。

注意：

- `serve` 只在 tailnet 内可用；手机没有加入 tailnet 时用 `funnel`。
- Funnel 是公网入口，建议同时开启设备吊销和配对策略管理。

## 四、FRP

适合有 VPS 和域名、希望自己控制链路的场景。

### frps.toml（VPS）

```toml
bindPort = 7000
vhostHTTPSPort = 443
```

如果 443 已被占用，可改成 `8443`，此时 `publicBaseUrl` 写成 `https://tron.example.com:8443`。

### frpc.toml（电脑，和 Tron 同一台机器）

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

要点：

- `localAddr` 指向 Tron remote listener。
- `crtPath` / `keyPath` 是该域名的证书；`https2http` 在 frpc 侧终止 TLS。
- `hostHeaderRewrite` 必须等于 `publicBaseUrl` 的域名，Tron 用它校验公网请求。
- `X-Forwarded-Proto` 必须显式设成 `https`，否则 Tron 会返回 400。
- frpc 和 Tron 在同一台机器，来源是 loopback，属于可信代理。

DNS：`tron.example.com` 的 A 记录指向 VPS；VPS 防火墙放行 `7000` 和 `443`。

启动：

```bash
frps -c frps.toml
frpc -c frpc.toml
```

## 五、Caddy / Nginx（有公网 IP 或已有反代）

### Caddy

```caddyfile
tron.example.com {
    reverse_proxy 127.0.0.1:8081
}
```

Caddy 自动申请证书、转发 WebSocket，并设置 `X-Forwarded-Proto`。

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

反代必须和 Tron 在同一台机器（来源是 loopback）。如果反代在另一台机器，需要把代理 CIDR 加入 Tron 的 `trustedProxies`；当前 Tron 还没有对应的 UI。

## 六、验证

先在本机模拟公网 Host：

```bash
curl -H 'Host: tron.example.com' \
     -H 'X-Forwarded-Proto: https' \
     http://127.0.0.1:8081/remote/identity
```

应返回 `nodeId`、`lanBaseUrl`、`publicBaseUrl` 等字段。

再从外网检查：

```bash
curl https://tron.example.com/health
curl https://tron.example.com/remote/identity
```

配对二维码应包含：

```text
lan=http://192.168.x.x:8081
public=https://tron.example.com
```

手机在家用 LAN，出门自动切到 public。

## 七、排错

| 现象 | 检查 |
| --- | --- |
| `400 Host does not match publicBaseUrl` | 代理没有保留正确 Host，或 `publicBaseUrl` 写错 |
| `400 public access requires HTTPS terminated by a trusted proxy` | 缺少 `X-Forwarded-Proto: https`，或来源不是 loopback/可信 CIDR |
| WebSocket 400 / 立即断开 | 代理没有转发 `Upgrade` / `Connection`，或超时太短 |
| 外网 502 | 代理连不到 `127.0.0.1:8081`，或 Tron 没开远程访问/没重启 |
| 配对二维码没有 public | `publicBaseUrl` 为空或不是 `https://` |
| 手机在家也走公网 | LAN 地址不可达；检查防火墙、端口、二维码里的 `lan` |
| 8081 被占用 | 改 `remoteAccess.port`，同步改代理和 `publicBaseUrl` |

## 安全建议

- 只暴露 HTTPS 代理端口，不直接暴露 remote listener。
- 使用有效证书，不要教用户关闭 TLS 校验。
- 定期在 Tron 设置页检查已配对设备，发现异常立即吊销。
- 公网入口本身不提供身份认证，安全边界依赖设备密钥和 Noise 握手；不要把 remote listener 直接放到公网。
