# CF-Server-Monitor 前端主题开发文档

> 面向 CF-Server-Monitor 前端主题开发的 API 参考。
>
> 本文档仅保留浏览器端调用的接口，去除后端内部实现细节。
>
> 如果仅需制作主题，无需关注管理端 API，直接跳转到 `/#/admin` 即可。

**Base URL**：`https://<your-worker-domain>`

**统一响应头**：

- `Content-Type: application/json`（除特别说明外）

***

## 目录

- [0. 运行时配置与版本升级提示](#0-运行时配置与版本升级提示)
- [1. 鉴权与 Turnstile 流程](#1-鉴权与-turnstile-流程)
- **[2. 公开 API](#2-公开-api)**
  - **[2.1 获取站点配置](#21-获取站点配置)**
  - **[2.2 获取服务器列表](#22-获取服务器列表)**
  - [2.3 获取服务器详情](#23-获取服务器详情)
  - [2.4 获取历史指标](#24-获取历史指标)
- [3. WebSocket 实时推送](#3-websocket-实时推送)
- [4. 错误处理](#4-错误处理)
- [5. 类型定义](#5-类型定义)

***

## 0. 运行时配置与版本升级提示

### 0.1 API Base 配置

`config.json` 已废弃，当前前端不会请求或读取 `config.json`。

默认情况下，前端使用当前页面同源地址作为 API Base，即 `window.location.origin`。Worker/Pages 同域部署时无需额外配置。

纯静态主题（例如 GitHub Pages）通过 HTML meta 标签配置后端地址：

```html
<meta name="apiBase" content="https://<your-worker-domain>,https://<your-worker-domain2>">
```

多个地址用英文逗号分隔。前端会按 `apiBase` 创建对应的 HTTP 请求和 WebSocket 连接，多站模式下每个后端只处理自己返回的服务器 ID。

跨域部署主题时，还需要在每个源站 Cloudflare Workers 的环境变量中添加 `CORS_ALLOWED_ORIGINS`，位置和添加 `API_SECRET` 相同。把本地开发地址和最终上线域名加入白名单；如果 `API_BASE` 配置了多个 Workers，每个 Workers 都要添加这一项。

```
https://localhost:5173,https://[你的github用户名].github.io
```

该值只填写 origin，多个值用英文逗号分隔，不要包含路径、查询参数或结尾 `/`。如果线上主题域名不是 Worker 同源域名，也必须加入这里，否则浏览器会拦截 API 请求和 WebSocket 连接。

使用项目内置静态主题构建脚本时，需要在主题项目 `.env` 中配置：

| 环境变量 | 说明 | 默认值 |
| --- | --- | --- |
| `API_BASE` | 后端地址，多个地址用英文逗号分隔 | 必填 https://<your-worker-domain> |
| `TITLE` | 静态页面标题 | 选填 |
| `BACKGROUND_IMAGE` | 静态页面背景图 | 选填 |
| `CSP_API` | 追加到 `connect-src` 的 API 白名单 | 选填 |
| `CSP_STATIC` | 追加到静态资源相关 CSP 指令的白名单 | 选填 |

运行：

```bash
npm run build:github-page
```

`csp_api` 和 `csp_static` 由后台外观设置保存，并在服务端返回 HTML 时注入 CSP；纯静态构建时使用上面的 `CSP_API` / `CSP_STATIC` 环境变量注入。

### 0.2 版本升级提示

`GET /api/config` 会返回当前 Workers 版本 `version`。当请求带有有效 JWT 时，后端还会查询远程最新版并额外返回：

- `last_workers_version`：最新 Workers 版本
- `last_agent_version`：最新探针 Agent 版本

内置主题会将 `version` 与 `last_workers_version` 做字符串比较；两者不一致时，页脚版本号旁显示升级提示圆点和 tooltip。`last_agent_version` 用于管理端服务器表格中的 Agent 版本对比，落后版本会以红色显示。

未登录访问 `/api/config` 时不会返回 `last_workers_version` / `last_agent_version`，自定义主题不要依赖匿名请求展示升级提示。

***

## 1. 鉴权与 Turnstile 流程

### 1.1 鉴权机制

项目使用两套鉴权机制：

| 机制         | 使用位置            | 方式                                           |
| ---------- | --------------- | -------------------------------------------- |
| JWT Bearer | 管理端 API、非公开站点访问 | `Authorization: Bearer <token>`              |
| Turnstile  | 公开 API（当启用时）    | `X-Turnstile-Token` 或 `X-Turnstile-Verified` |

### 1.2 Turnstile 人机验证流程

```
1. 首次访问 → GET /api/config → 获取 turnstile_site_key
2. 渲染 Turnstile 组件 → 获取一次性 token
3. 后续请求 → 携带 X-Turnstile-Token 头
4. 验证成功 → /api/config 响应体返回 turnstile_verified（加密凭证，有效期 1 小时）
5. 后续请求 → 可复用 X-Turnstile-Verified，省略 X-Turnstile-Token
```

**相关 Header**：

| Header                 | 方向              | 说明                        |
| ---------------------- | --------------- | ------------------------- |
| `X-Turnstile-Token`    | Client → Server | 当次 Turnstile token（明文）    |
| `X-Turnstile-Verified` | Client → Server | AES-GCM 加密的已验证凭证，客户端应缓存复用 |

**注意**：

- `/api/ws`、`/api/config`（不带 Turnstile Header 时）无需验证
- `/api/config` 带 `X-Turnstile-Token` 或 `X-Turnstile-Verified` 时会进入验证流程，并通过 `verified` / `turnstile_verified` 返回验证结果
- `turnstile_enabled` 是全局 API 验证开关，`turnstile_login_enabled` 是登录页验证开关；`/api/config` 返回的 `turnstile_login_enabled` 在全局验证开启时也会为 `true`

***

## 2. 公开 API

> 若站点非公开（`is_public !== 'true'`），所有接口需携带 JWT。
> 启用 Turnstile 时需携带 `X-Turnstile-Token` 或 `X-Turnstile-Verified`。

### 2.1 获取站点配置

**Request**

```
GET /api/config
Headers: (可选) Authorization: Bearer <jwt>, X-Turnstile-Token / X-Turnstile-Verified
```

**Response**

```json
{
  "version": "2.7.12 Beta",
  "last_workers_version": "2.7.13",
  "last_agent_version": "1.3.3",
  "is_public": true,
  "authorization": true,
  "turnstile_enabled": true,
  "turnstile_login_enabled": true,
  "turnstile_site_key": "1x00000000000000000000AA",
  "site_title": "My Server Monitor",
  "theme_options": {
    "a": 1,
    "b": 2
  },
  "verified": false,
  "turnstile_verified": null,
  "show_long_history": true
}
```

**字段说明**：

| 字段                   | 类型           | 说明              |
| -------------------- | ------------ | --------------- |
| `version`            | string       | 当前 Workers 版本号 |
| `last_workers_version` | string\|null | 最新 Workers 版本，仅登录后返回 |
| `last_agent_version` | string\|null | 最新 Agent 版本，仅登录后返回 |
| `is_public`          | boolean      | 是否公开站点             |
| `authorization`      | boolean      | 是否通过登录验证       |
| `turnstile_enabled`  | boolean      | 是否启用全局 API 人机验证 |
| `turnstile_login_enabled` | boolean | 是否启用登录页人机验证 |
| `turnstile_site_key` | string       | Turnstile 前端公钥  |
| `site_title`         | string       | 站点标题 |
| `theme_options`      | object       | 第三方主题自定义配置；未配置时为空对象 |
| `verified`           | boolean      | 当前请求是否已验证       |
| `turnstile_verified` | string\|null | 已验证凭证，缓存复用 1 小时 |
| `show_long_history`  | boolean      | 是否允许查看超过 1 小时历史 |

第三方主题如需保存自定义配置，仍使用后台 `save_settings` 接口，并把对象放在 `settings.appearance_options.theme_options`，例如 `{"appearance_options":{"theme_options":{"a":1,"b":2}}}`。

**示例**：

```js
const res = await fetch('/api/config');
const config = await res.json();
```

***

### 2.2 获取服务器列表

**Request**

```
GET /api/servers
Headers: (按需) Authorization: Bearer <jwt>, X-Turnstile-Token/Verified
```

**Response**

```json
{
  "servers": [ /* Server[] */ ],
  "stats": {
    "total": 10,
    "online": 8,
    "offline": 2,
    "globalSpeedIn": 1234.5,
    "globalSpeedOut": 567.8,
    "globalNetTx": 1234567890,
    "globalNetRx": 9876543210
  },
  "regionStats": { "US": 3, "JP": 2, "CN": 5 },
  "sysConfig": {
    "show_price": true,
    "show_expire": true,
    "show_tf": true,
    "show_time": true
  }
}
```

**字段说明**：

| 字段            | 说明                          |
| ------------- | --------------------------- |
| `servers`     | 服务器列表（含最新指标），未登录用户自动过滤隐藏服务器；`tags` 始终随服务器返回 |
| `stats`       | 聚合统计（在线阈值 5 分钟）             |
| `regionStats` | 按区域统计服务器数量                  |
| `sysConfig`   | 站点开关配置，控制 UI 显示             |

**示例**：

```js
const res = await fetch('/api/servers', {
  headers: { 'Authorization': 'Bearer ' + token }
});
const { servers, stats, sysConfig } = await res.json();
```

***

### 2.3 获取服务器详情

**Request**

```
GET /api/server?id=<uuid>
Headers: (按需) Authorization, X-Turnstile-Token/Verified
```

**Response**

```json
{
  "id": "9b2c...",
  "name": "HK-01",
  "server_group": "HK",
  "tags": "prod,edge",
  "price": "30.00",
  "billing_cycle": "month",
  "auto_renewal": "0",
  "currency": "¥",
  "expire_date": "2026-12-31",
  "traffic_limit": "1TB",
  "traffic_calc_type": "total",
  "reset_day": 1,
  "report_interval": 60,
  "is_hidden": "0",
  "sort_order": 0,
  "cpu": 12.34,
  "load_avg": "0.10 0.20 0.30",
  "net_in_speed": 1024,
  "net_out_speed": 512,
  "net_rx": 12345678,
  "net_tx": 87654321,
  "net_rx_monthly": 1073741824,
  "net_tx_monthly": 536870912,
  "processes": 256,
  "tcp_conn": 32,
  "udp_conn": 4,
  "ping_ct": 23, "ping_cu": 25, "ping_cm": 30, "ping_bd": 40,
  "loss_ct": 0, "loss_cu": 0, "loss_cm": 0, "loss_bd": 0,
  "ram_total": 8192, "ram_used": 3700,
  "swap_total": 2048, "swap_used": 100,
  "disk_total": 102400, "disk_used": 32000,
  "cpu_cores": 4, "cpu_info": "Intel Xeon",
  "gpu": 12.5, "gpu_info": "NVIDIA RTX 3060",
  "arch": "x86_64", "os": "Ubuntu 22.04",
  "region": "HK",
  "ip_v4": "1", "ip_v6": "1",
  "boot_time": "1700000000000",
  "last_updated": 1737638400000,
  "timestamp": 1737638400000,
  "sysConfig": { "show_long_history": true }
}
```

`tags` 为英文逗号分隔字符串。`note` 属于管理端内部字段，不从 dashboard 公共接口返回。

**失败返回**：

- `400 { "error": "Missing ID" }`
- `404 { "error": "Server not found" }`

**示例**：

```js
const res = await fetch(`/api/server?id=${serverId}`);
const server = await res.json();
```

***

### 2.4 获取历史指标

**Request**

```
GET /api/history/all?id=<uuid>&hours=<number>
Headers: (按需) Authorization, X-Turnstile-Token/Verified
```

**参数**：

- `id`（必填）：服务器 UUID
- `hours`（可选，默认 24）：查询时长，可选 `0.167`、`0.5`、`1`、`6`、`12`、`24`、`48`、`96`、`168`，最大 168（7 天）

**Response**

```json
[
  { "timestamp": 1737600000000, "cpu": 12.3, "gpu": null, "ram_used": 3700 },
  { "timestamp": 1737600600000, "cpu": 13.1, "gpu": null, "ram_used": 3712 }
]
```

**注意**：

- 未登录用户 `hours > 1` 时返回 `401`
- 服务端最多返回约 160 个采样点，会按查询时长自动降采样
- 数据库字段缺失且需要升级时可能返回 `409 { "message": "databaseUpgradeRequired" }`

**示例**：

```js
const res = await fetch(`/api/history/all?id=${serverId}&hours=24`);
const rows = await res.json();
```

***

## 3. WebSocket 实时推送

**Request**

```
GET /api/ws?subscribe=<all|serverId>
Headers: Upgrade: websocket, Connection: Upgrade
```

**参数**：

| 参数 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `subscribe` | 否 | `all` | `all` 订阅所有服务器，`<serverId>` 只订阅指定服务器 |

**过滤机制**：

- `subscribe=all` + 通道内发送 `subscribe` 消息：仅接收 `ids` 列表中的服务器更新
- `subscribe=all` + 未发送 `subscribe` 消息：**不返回任何更新**
- `subscribe=<serverId>`：始终只接收该服务器更新，不需要发送 `ids`
- `ids` 最多 500 个，每个 ID 长度 1-64，仅允许字母、数字、`.`、`_`、`:`、`-`
- `scope` 或 `ids` 格式非法时服务端会关闭 WebSocket 连接（close code `1008`）
- `ids` 是客户端订阅过滤，不是服务端鉴权

**多 apiBase 注意事项**：

当配置了多个 `apiBase` 时，前端会为每个 apiBase 创建独立的 WebSocket 连接。每个连接发送的 `ids` 应只包含该 apiBase 返回的服务器 ID，而非全部服务器 ID。每个 Worker/DO 只知道自己的服务器，传入不属于它的 ID 不会产生任何效果。

**推荐流程**：

1. 调用 `GET /api/servers` 获取服务器列表（已按登录状态过滤隐藏服务器）
2. 提取返回的 `servers[].id` 数组
3. 连接 WebSocket：`?subscribe=all`
4. 建连后通过 WebSocket 通道发送 `{ type: "subscribe", scope: "all", ids }`

**推送策略**：

| 订阅类型 | 推送方式 | 消息类型 | 说明 |
| -------- | ----- | ----- | --- |
| `subscribe=all` | 批量合并，每 5 秒一次 | `batchUpdate` | 减少消息数量，降低前端渲染压力 |
| `subscribe=<serverId>` | 实时推送 | `batchUpdate` | 单台服务器详情页，低延迟，统一消息格式 |

**消息格式**：

| 类型 | 方向 | 数据结构 |
| --- | --- | --- |
| `hello` | S → C | `{ type: "hello", ts: number, subscribed: string }` |
| `subscribe` | C → S | `{ type: "subscribe", scope: string, ids: string[] }` |
| `subscribed` | S → C | `{ type: "subscribed", ts: number, subscribed: string, count: number }` |
| `ping` | C → S | `{ type: "ping", ts: number }` |
| `pong` | 双向 | `{ type: "pong", ts: number }` |
| `batchUpdate` | S → C | `{ type: "batchUpdate", ts: number, updates: Array<{serverId, samples: Array<{ts, data}>}> }` |

**示例（subscribe=all，带 ID 过滤）**：

```js
// 1. 获取服务器列表
const { servers } = await (await fetch('/api/servers')).json();
const ids = servers.map(s => s.id);

// 2. 连接 WebSocket，并通过通道消息提交订阅 ID 列表
const ws = new WebSocket('wss://status.example.com/api/ws?subscribe=all');
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'subscribe', scope: 'all', ids }));
};
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'batchUpdate') {
    for (const u of msg.updates) {
      for (const s of u.samples || []) {
        updateServer(u.serverId, s.data);
      }
    }
  }
};
```

**示例（subscribe=serverId，实时推送）**：

```js
const ws = new WebSocket('wss://status.example.com/api/ws?subscribe=server-001');
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'batchUpdate') {
    for (const u of msg.updates) {
      for (const s of u.samples) {
        updateServer(u.serverId, s.data);
      }
    }
  }
};
```

***

## 4. 错误处理

### 统一响应格式

**成功响应**：

成功响应直接返回业务对象或数组，具体结构见各接口；没有统一的 `success: true` 包装字段。

**错误响应**：

```json
{ "error": "human readable message", "code": 400 }
```

### 错误码速查表

| code | 含义             | 处理建议                 |
| ---- | -------------- | -------------------- |
| 400  | 参数错误           | 检查参数格式和必填项           |
| 401  | 未授权            | 重新登录或检查 JWT          |
| 403  | Turnstile 验证失败 | 重新获取 Turnstile token |
| 404  | 资源不存在          | 检查服务器 ID             |
| 409  | 数据库需升级        | 提示管理员执行数据库升级      |
| 500  | 服务器内部错误        | 联系管理员                |
| 503  | WebSocket 不可用  | 降级为轮询                |

***

## 5. 类型定义

```typescript
interface Server {
  id: string;
  name: string;
  server_group: string;
  tags: string;
  price: string; // "0" 或 "-1" 表示免费，空白表示未设置
  billing_cycle: string;
  auto_renewal: string;
  currency: string;
  expire_date: string;
  traffic_limit: string;
  traffic_calc_type: string;
  reset_day: number;
  report_interval: number;
  is_hidden: '0' | '1';
  sort_order: number;
  cpu: number;
  load_avg: string;
  net_in_speed: number;
  net_out_speed: number;
  net_rx: number;
  net_tx: number;
  net_rx_monthly: number;
  net_tx_monthly: number;
  processes: number;
  tcp_conn: number;
  udp_conn: number;
  ping_ct: number | null;
  ping_cu: number | null;
  ping_cm: number | null;
  ping_bd: number | null;
  loss_ct: number | null;
  loss_cu: number | null;
  loss_cm: number | null;
  loss_bd: number | null;
  ram_total: number;
  ram_used: number;
  swap_total: number;
  swap_used: number;
  disk_total: number;
  disk_used: number;
  cpu_cores: number;
  cpu_info: string;
  gpu: number | null;
  gpu_info: string;
  arch: string;
  os: string;
  region: string;
  ip_v4: '0' | '1';
  ip_v6: '0' | '1';
  boot_time: string;
  agent_version?: string;
  last_updated: number;
  timestamp: number;
  is_online?: boolean;
  sysConfig?: SysConfig;
}

interface SysConfig {
  show_price?: boolean;
  show_expire?: boolean;
  show_tf?: boolean;
  show_time?: boolean;
  show_long_history?: boolean;
}

interface SiteConfig {
  version: string;
  last_workers_version?: string | null;
  last_agent_version?: string | null;
  is_public: boolean;
  authorization: boolean;
  turnstile_enabled: boolean;
  turnstile_login_enabled: boolean;
  turnstile_site_key: string;
  site_title: string;
  verified: boolean;
  turnstile_verified: string | null;
  show_long_history: boolean;
}

interface Settings {
  site_title: string;
  custom_bg: string;
  custom_head: string;
  custom_script: string;
  csp_static: string;
  csp_api: string;
  is_public: 'true' | 'false';
  show_price: 'true' | 'false';
  show_expire: 'true' | 'false';
  show_tf: 'true' | 'false';
  show_time: 'true' | 'false';
  show_long_history: 'true' | 'false';
  tg_notify: '0' | '2' ... '30'; // 0 = 关闭；旧值 false 兼容为 0，true 兼容为 5
  tg_bot_token: string;
  tg_chat_id: string;
  turnstile_enabled: 'true' | 'false';
  turnstile_login_enabled: 'true' | 'false';
  turnstile_site_key: string;
  turnstile_secret_key: string;
  jwt_secret: string;
  username: string;
  password: string;
  cloudflare_account_id: string;
  cloudflare_token: string;
  custom_ct: string;
  custom_cu: string;
  custom_cm: string;
  custom_bd: string;
  expire_reminder: 'true' | 'false';
}

interface WsMessage {
  type: 'hello' | 'subscribe' | 'subscribed' | 'ping' | 'pong' | 'batchUpdate';
  ts?: number;
  subscribed?: string;
  scope?: string;
  ids?: string[];
  count?: number;
  serverId?: string;
  updates?: Array<{
    serverId: string;
    samples: Array<{ ts: number; data: Server }>;
  }>;
}
```
