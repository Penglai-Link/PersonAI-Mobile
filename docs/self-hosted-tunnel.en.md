# Self-hosted public tunnel

<p align="center">
  <a href="self-hosted-tunnel.md">简体中文</a> · <b>English</b> · <a href="self-hosted-tunnel.ja.md">日本語</a>
</p>

PersonAI Mobile does not provide a public relay. When the phone is away from the computer's Wi-Fi, you need your own HTTPS entry point that forwards traffic to Tron's remote listener.

This guide covers Cloudflare Tunnel, Tailscale, FRP, and Caddy/Nginx. For protocol and encryption details, see [Remote access internals](remote-access.en.md).

## How it works

```text
Phone ──wss──▶ HTTPS entry point (TLS termination)
                      │  HTTP + WebSocket Upgrade
                      ▼
              Tron remote listener 127.0.0.1:8081
```

The proxy must:

- preserve `Host: <the publicBaseUrl host>`;
- forward WebSocket upgrades;
- set `X-Forwarded-Proto: https` (or an equivalent `Forwarded` value);
- be able to reach Tron's remote listener.

Public TLS protects only the outer layer; TRP has Noise end-to-end encryption inside it, so the proxy cannot read session content.

## 1. Configure Tron first

Enable remote access in Tron Settings, or edit the config file:

```yaml
# ~/.tron/application.yaml (macOS/Linux)
remoteAccess:
  enabled: true
  port: 8081
  publicBaseUrl: https://tron.example.com
```

Notes:

- `port` is the remote listener port. The default `0` means main port + 1; this example uses `8081`. If 8081 is taken by Expo or another dev tool, use a free port such as `18081`.
- `publicBaseUrl` must be `https://` and match the domain used by the proxy (include the port in the URL when non-default).
- Restart Tron after changing it; the remote listener is bound at startup.
- Do not expose `8081` directly to the internet; expose only the HTTPS proxy.

Check:

```bash
curl http://127.0.0.1:8081/health
curl http://127.0.0.1:8080/api/v1/remote/service/pairing
```

The `pairingUri` will contain both `lan` and `public` addresses.

## 2. Cloudflare Tunnel (no public IP)

Good when you have a domain and do not want to open router ports.

Quick test:

```bash
cloudflared tunnel --url http://127.0.0.1:8081
```

It prints a `https://xxx.trycloudflare.com` URL. Set that as `publicBaseUrl` to pair from outside. The URL changes on restart, so use it only for testing.

Stable domain:

```bash
cloudflared tunnel login
cloudflared tunnel create tron
cloudflared tunnel route dns tron tron.example.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: <tunnel-uuid>
credentials-file: /Users/you/.cloudflared/<tunnel-uuid>.json
ingress:
  - hostname: tron.example.com
    service: http://127.0.0.1:8081
  - service: http_status:404
```

Run:

```bash
cloudflared tunnel run tron
```

Cloudflare handles TLS and sends `X-Forwarded-Proto: https`; WebSocket is supported natively.

## 3. Tailscale

Good when both the computer and phone are on your tailnet.

Tailnet-only:

```bash
tailscale serve --bg 8081
```

Public internet (requires HTTPS/Funnel to be enabled):

```bash
tailscale funnel --bg 8081
```

Use the resulting `https://<machine>.<tailnet>.ts.net` URL as `publicBaseUrl`. Tailscale proxies locally, so Tron sees a loopback source, which is trusted.

Notes:

- `serve` works only inside the tailnet; use `funnel` when the phone is not on the tailnet.
- Funnel is a public entry point; keep device revocation and pairing policy under control.

## 4. FRP

Good when you have a VPS and domain and want to control the path yourself.

### frps.toml (VPS)

```toml
bindPort = 7000
vhostHTTPSPort = 443
```

If 443 is taken, use `8443` and set `publicBaseUrl` to `https://tron.example.com:8443`.

### frpc.toml (computer, same machine as Tron)

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

Key points:

- `localAddr` points at Tron's remote listener.
- `crtPath` / `keyPath` are the certificate for that domain; `https2http` terminates TLS in frpc.
- `hostHeaderRewrite` must equal the `publicBaseUrl` host; Tron validates public requests with it.
- Set `X-Forwarded-Proto` explicitly to `https`, otherwise Tron returns 400.
- frpc and Tron run on the same machine, so the source is loopback and counts as a trusted proxy.

DNS: point `tron.example.com` at the VPS; open `7000` and `443` in the VPS firewall.

Run:

```bash
frps -c frps.toml
frpc -c frpc.toml
```

## 5. Caddy / Nginx (public IP or existing proxy)

### Caddy

```caddyfile
tron.example.com {
    reverse_proxy 127.0.0.1:8081
}
```

Caddy obtains certificates, forwards WebSocket, and sets `X-Forwarded-Proto`.

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

The reverse proxy should run on the same machine as Tron (loopback source). If it runs elsewhere, add the proxy CIDR to Tron's `trustedProxies`; Tron does not expose a UI for that yet.

## 6. Verify

Simulate the public Host locally:

```bash
curl -H 'Host: tron.example.com' \
     -H 'X-Forwarded-Proto: https' \
     http://127.0.0.1:8081/remote/identity
```

It should return `nodeId`, `lanBaseUrl`, `publicBaseUrl`, and related fields.

From outside:

```bash
curl https://tron.example.com/health
curl https://tron.example.com/remote/identity
```

The pairing QR should contain:

```text
lan=http://192.168.x.x:8081
public=https://tron.example.com
```

The phone uses LAN at home and switches to public when away.

## 7. Troubleshooting

| Symptom | Check |
| --- | --- |
| `400 Host does not match publicBaseUrl` | Proxy does not preserve Host, or `publicBaseUrl` is wrong |
| `400 public access requires HTTPS terminated by a trusted proxy` | Missing `X-Forwarded-Proto: https`, or source is not loopback/trusted CIDR |
| WebSocket 400 / closes immediately | Proxy does not forward `Upgrade` / `Connection`, or timeout is too short |
| 502 from outside | Proxy cannot reach `127.0.0.1:8081`, or Tron remote access is not enabled/restarted |
| QR has no public address | `publicBaseUrl` is empty or not `https://` |
| Phone uses public at home too | LAN is unreachable; check firewall, port, and the `lan` field in the QR |
| 8081 already in use | Change `remoteAccess.port` and update the proxy and `publicBaseUrl` |

## Security recommendations

- Expose only the HTTPS proxy port, never the remote listener directly.
- Use a valid certificate; do not disable TLS verification.
- Review paired devices in Tron Settings and revoke anything suspicious.
- The entry point itself provides no authentication; security depends on the device key and Noise handshake. Never put the remote listener directly on the public internet.
