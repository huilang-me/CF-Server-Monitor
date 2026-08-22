# CF-Server-Monitor 第三方主题开发 API 文档

> 面向第三方主题开发作者的 API 参考。
>
> 本文档只保留第三方主题可用的公开 API、WebSocket 和静态目录约定，不介绍后台管理接口。
>
> 管理后台固定由默认主题接管；主题中的管理入口只能跳转到 `/admin#admin`。

**Base URL**：`https://<your-worker-domain>`

**统一响应头**：

- `Content-Type: application/json`（除特别说明外）

***

## 目录

- [0. 运行时配置、构建产物与版本升级提示](#0-运行时配置构建产物与版本升级提示)
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

## 0. 运行时配置、构建产物与版本升级提示

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

纯静态构建时，`API_BASE`、`TITLE`、`BACKGROUND_IMAGE`、`CSP_API`、`CSP_STATIC` 会写入 HTML 运行时配置。后台外观设置中的 `csp_api` 和 `csp_static` 也会影响页面允许加载的第三方 API 和静态资源域名。

### 0.2 主题构建产物约定

主题完成后提交到 [huilang-me/CFSM-Theme-Store](https://github.com/huilang-me/CFSM-Theme-Store) 项目。

主题构建产物仅需要：

- `index.html`
- `assets/` 目录

目录结构示例：

```
my-theme/
├── index.html
└── assets/
    ├── app.css
    ├── app.js
    └── logo.webp
```

主题开发注意事项：

- 主题提交目录只能生成 `index.html` 和 `assets/`；不要依赖其他主题目录或根目录文件
- 静态资源应放在主题目录的 `assets/` 下，并在 HTML/JS/CSS 中使用 `/assets/...` 或相对 `assets/...`
- 旗帜和 OS 图标走默认皮肤静态文件，不要打包进主题：旗帜使用 `/flags/<code>.svg`，OS 图标使用 `/os-icons/<filename>`
- 站点标题、背景图、自定义 `<head>`、自定义脚本由用户后台外观设置控制，主题不要把这些配置写死
- 主题不可用时应让页面暴露加载错误，不要在主题内静默跳转到其他页面
- 主题底部需要展示 `Powered by CF-Server-Monitor`，并链接到 [https://github.com/huilang-me/CF-Server-Monitor/](https://github.com/huilang-me/CF-Server-Monitor/)；建议同时输出 `/api/config` 返回的 `version`，例如 `Powered by CF-Server-Monitor v2.7.12 Beta`

路由约定：

- 首页：`/#/` 或 `/#`
- 详情页：`/#/server/:id`
- 管理后台：链接到 `/admin#admin`，由内置默认主题接管，第三方主题不得实现管理页

### 0.3 版本升级提示

`GET /api/config` 会返回当前 Workers 版本 `version`。当请求带有有效 JWT 时，后端还会查询远程最新版并额外返回：

- `last_workers_version`：最新 Workers 版本
- `last_agent_version`：最新探针 Agent 版本

第三方主题可以将 `version` 与 `last_workers_version` 做字符串比较，自行决定是否展示 Workers 升级提示。`last_agent_version` 仅在登录后返回，可用于可选的 Agent 版本提示。

未登录访问 `/api/config` 时不会返回 `last_workers_version` / `last_agent_version`，自定义主题不要依赖匿名请求展示升级提示。

***

## 1. 鉴权与 Turnstile 流程

### 1.1 鉴权机制

项目使用以下鉴权机制：

| 机制         | 使用位置            | 方式                                           |
| ---------- | --------------- | -------------------------------------------- |
| JWT Bearer | 非公开站点读取公开 API、查看 1 小时以上历史 | `Authorization: Bearer <token>`              |
| WebSocket JWT | 非公开站点连接 `/api/ws` | `Authorization: Bearer <token>`、`Cookie: cfsm_auth=<token>` 或查询参数 `token` / `auth_token` / `ws_token` |
| Turnstile  | 公开 API（当启用时）    | `X-Turnstile-Token` 或 `X-Turnstile-Verified` |

浏览器原生 WebSocket 不能自定义 `Authorization` Header。第三方主题在私有站点中连接 `/api/ws` 时，同域走登录后的 `cfsm_auth` Cookie，跨域走 WebSocket URL 查询参数 `token=<jwt>`。查询参数 token 可能出现在访问日志中，请只通过 HTTPS 使用。

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
- `/api/ws` 不参与 Turnstile 验证，但非公开站点仍需要通过 WebSocket JWT 认证
- `turnstile_enabled` 是全局 API 验证开关，`turnstile_login_enabled` 是内置后台登录页验证开关；第三方主题不实现登录页，管理入口跳转 `/admin#admin`

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
  "frontend_ws_timeout_minutes": 20,
  "long_history_points": 120
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
| `frontend_ws_timeout_minutes` | number | 前端实时订阅连接超时分钟数，范围 `0`-`1440`；默认 `0` 表示不超时 |
| `long_history_points` | number      | 长历史查询返回的采样点数，可选 `60`、`120`、`180`、`240` |

`theme_options` 对第三方主题是只读运行时配置。需要修改主题配置时，跳转到内置后台 `/admin#admin`，不要在第三方主题内调用管理端接口。

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
    "show_three_net_details": true
  }
}
```

**字段说明**：

| 字段            | 说明                          |
| ------------- | --------------------------- |
| `servers`     | 服务器列表（含最新指标），未登录用户自动过滤隐藏服务器；`tags` 始终随服务器返回 |
| `stats`       | 聚合统计（在线阈值 5 分钟）             |
| `regionStats` | 按区域统计服务器数量                  |
| `sysConfig`   | 站点开关配置，控制 UI 显示；主题配置请从 `/api/config` 的 `theme_options` 读取 |

`servers[].ping` / `servers[].loss` 仅在列表接口返回，点格式为 `{ ts, ct, cu, cm, bd }`。只有后台开启三网详情（`sysConfig.show_three_net_details === true`）时，后端才会从 D1 最近 1 小时历史中抽样这些窗口数据；关闭时为节省 D1 / Workers 消耗，数组为空。

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
  "wss_report_interval": 2,
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
  "disk": {
    "read_bps": 4096,
    "write_bps": 2048,
    "read_iops": 12,
    "write_iops": 8,
    "await_ms": 1.5,
    "util": 3.2
  },
  "cpu_cores": 4, "cpu_info": "Intel Xeon",
  "gpu_info": "[{\"id\":\"0\",\"name\":\"NVIDIA RTX 3060\",\"info\":12.5}]",
  "arch": "x86_64", "os": "Ubuntu 22.04",
  "kernel_version": "6.8.0-36-generic",
  "region": "HK",
  "ip_v4": "1", "ip_v6": "1",
  "boot_time": "1700000000000",
  "last_updated": 1737638400000,
  "timestamp": 1737638400000,
  "latestReportUpdates": [
    {
      "serverId": "9b2c...",
      "reportTs": 1737638405000,
      "reportAgeMs": 1200,
      "samples": [
        {
          "ts": 1737638400000,
          "data": {
            "cpu": 12.34,
            "ram_total": 8192,
            "ram_used": 3700,
            "swap_total": 1024,
            "swap_used": 64,
            "net_in_speed": 1024,
            "net_out_speed": 512
          }
        }
      ]
    }
  ],
  "sysConfig": { "long_history_points": 120 }
}
```

`tags` 为英文逗号分隔字符串。`note` 属于管理端内部字段，不从 dashboard 公共接口返回。`disk` 为可选磁盘 IO 指标对象：`read_bps` / `write_bps` 单位为 B/s，`read_iops` / `write_iops` 为 IOPS，`await_ms` 为毫秒，`util` 为百分比；旧探针、旧数据缺失，或者 6 个子字段全为 0 时，API / WebSocket 不返回该对象，主题不应展示依赖磁盘 IO 的图表。`latestReportUpdates` 与 `/api/servers` 同名字段形状一致，REST 样本统一为 `{ ts, data }` 并按探针批量采样包透传；内置探针默认只在普通采样点上报 `cpu`、`ram_total`、`ram_used`、`swap_total`、`swap_used`、`net_in_speed`、`net_out_speed`，每次报告最后一个样本可能额外携带 `disk` 等报告级字段；回放状态保留约 5 分钟，允许为空数组。`gpu` 已废弃，主题应使用 `gpu_info`；新版上报和 WebSocket 实时数据为 `[{ id, name, info }]` 数组，历史/详情 REST 响应中可能是同结构的 JSON 字符串。

`ping` / `loss` 窗口数组仅在 `/api/servers` 的 `servers[]` 中返回，`/api/server` 详情接口不返回新增窗口数组。只有后台开启三网详情时才会查询窗口数据；关闭时后端仍返回 `ping: []` / `loss: []`，主题不应展示三网小图。开启后，窗口从 D1 历史表最近 1 小时按时间范围抽样，最多 30 个真实样本点，点格式为 `{ ts, ct, cu, cm, bd }`，其中 `ct` / `cu` / `cm` / `bd` 分别对应不同探测线路。时间间隔目标约 2 分钟，但 `ts` 保留真实上报时间，不会强制对齐为等差序列；历史不足、上报中断或某个时间段无数据时不会用最近点补齐，数组可能少于 30 个。该 D1 抽样结果在当前 Worker isolate 内缓存约 2 分钟，缓存不跨 isolate 共享。

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
  {
    "timestamp": 1737600000000,
    "cpu": 12.3,
    "gpu_info": "[{\"id\":\"0\",\"name\":\"NVIDIA RTX 3060\",\"info\":12.5}]",
    "ram_used": 3700,
    "disk_read_bps": 4096,
    "disk_write_bps": 2048,
    "disk_read_iops": 12,
    "disk_write_iops": 8,
    "disk_await_ms": 1.5,
    "disk_util": 3.2,
    "disk": {
      "read_bps": 4096,
      "write_bps": 2048,
      "read_iops": 12,
      "write_iops": 8,
      "await_ms": 1.5,
      "util": 3.2
    },
    "kernel_version": "6.8.0-36-generic"
  },
  {
    "timestamp": 1737600600000,
    "cpu": 13.1,
    "gpu_info": "[{\"id\":\"0\",\"name\":\"NVIDIA RTX 3060\",\"info\":13.0}]",
    "ram_used": 3712,
    "disk": {
      "read_bps": 5120,
      "write_bps": 1024,
      "read_iops": 15,
      "write_iops": 4,
      "await_ms": 1.2,
      "util": 2.8
    },
    "kernel_version": "6.8.0-36-generic"
  }
]
```

**注意**：

- 未登录用户 `hours > 24` 时返回 `401`
- 服务端按后台 `long_history_points` 配置返回采样点，默认 120 个点
- 历史行有磁盘 IO 数据时会返回 `disk` 对象；为兼容历史存储，也可能同时包含 `disk_read_bps`、`disk_write_bps`、`disk_read_iops`、`disk_write_iops`、`disk_await_ms`、`disk_util` 平铺字段。主题只需要读取 `disk`；缺失时不应展示磁盘 IO 图表
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
| `token` / `auth_token` / `ws_token` | 否 | - | 非公开站点可用的 JWT 查询参数认证；公开站点不需要 |

**鉴权**：

- 公开站点：无需 JWT。
- 非公开站点：连接 `/api/ws` 必须通过 WebSocket JWT 认证，支持 `Authorization: Bearer <jwt>`、`Cookie: cfsm_auth=<jwt>`、查询参数 `token` / `auth_token` / `ws_token`。
- 浏览器主题通常不能设置 WebSocket `Authorization` Header；同域部署使用 `cfsm_auth` Cookie，跨域或纯静态主题在 WebSocket URL 上追加 `token=<jwt>`。

**过滤机制**：

- `subscribe=all` + 通道内发送 `subscribe` 消息：仅接收 `ids` 列表中的服务器更新
- `subscribe=all` + 未发送 `subscribe` 消息：**不返回任何更新**
- `subscribe=<serverId>`：始终只接收该服务器更新，不需要发送 `ids`
- `ids` 最多 500 个，每个 ID 长度 1-64，仅允许字母、数字、`.`、`_`、`:`、`-`
- `scope` 或 `ids` 格式非法时服务端会关闭 WebSocket 连接（close code `1008`）
- `ids` 是客户端订阅过滤，不是服务端鉴权

**多 apiBase 注意事项**：

当配置了多个 `apiBase` 时，前端会为每个 apiBase 创建独立的 WebSocket 连接。每个连接发送的 `ids` 应只包含该 apiBase 返回的服务器 ID，而非全部服务器 ID。每个 Worker/DO 只知道自己的服务器，传入不属于它的 ID 不会产生任何效果。

**推荐流程（首页/列表页）**：

1. 调用 `GET /api/servers` 获取服务器列表（已按登录状态过滤隐藏服务器）
2. 提取返回的 `servers[].id` 数组
3. 连接 WebSocket：`?subscribe=all`
4. 建连后通过 WebSocket 通道发送 `{ type: "subscribe", scope: "all", ids }`

**推荐流程（详情页）**：

详情页只展示单台服务器时，应使用单服务器接口和单服务器 WebSocket 订阅，以降低后端推送量、前端渲染压力和额度消耗：

- HTTP 初始数据：`GET https://example.com/api/server?id=<id>`
- WebSocket 实时订阅：`wss://example.com/api/ws?subscribe=<id>`

非公开站点同域部署时直接使用 Cookie 认证；跨域或纯静态主题无法依赖同域 Cookie 时，再使用查询参数认证：`wss://example.com/api/ws?subscribe=<id>&token=<jwt>`。

详情页不要使用 `GET https://example.com/api/servers` 拉全量列表，也不要使用 `wss://example.com/api/ws?subscribe=all` 订阅全量更新后再在前端过滤。

**页面可见性建议**：

为实现前端展示效果并节省额度消耗，主题应监听 `document.visibilitychange`，页面进入后台或隐藏时主动关闭 WebSocket，页面重新可见时再按当前页面类型重新连接并恢复订阅。关闭连接后可保留最后一次数据用于静态展示；重新可见时建议先按当前页面补一次 REST 数据，再恢复 WebSocket 实时更新。

主题还应读取 `/api/config` 的 `frontend_ws_timeout_minutes`。值为 `0` 时不按连接时长断开；值为正整数时，应在单次连接达到对应分钟数后主动关闭，并由用户明确选择是否继续连接。继续后应建立新连接并重新开始计时，不应在用户选择关闭后静默重连。

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
| `batchUpdate` | S → C | `{ type: "batchUpdate", ts: number, updates: Array<{serverId, samples: Array<{ts, data?: Partial<Server>, payload?: Partial<Server>, metrics?: Partial<Server>}>}> }` |

`batchUpdate.samples[]` 的指标对象可能出现在 `data`、`payload` 或 `metrics` 中，主题应按 `sample.data || sample.payload || sample.metrics` 读取。该对象是增量字段：批次内的高频采样点主要包含 CPU、内存、Swap、网速和时间字段；每次上报的最后一个样本会额外携带本次完整报告状态，用于同步磁盘容量、磁盘 IO、GPU、进程、连接数、探针、Ping/丢包等报告级数据。`disk` 缺失、格式无效或所有子字段全为 0 时，WebSocket 样本不会携带 `disk`。

**示例（subscribe=all，带 ID 过滤）**：

```js
// 1. 获取服务器列表
const { servers } = await (await fetch('/api/servers')).json();
const ids = servers.map(s => s.id);

// 2. 连接 WebSocket，并通过通道消息提交订阅 ID 列表
const url = new URL('wss://status.example.com/api/ws');
url.searchParams.set('subscribe', 'all');
const sameHost = url.host === location.host;
if (!sameHost) {
  const token = localStorage.getItem('jwt_token');
  if (token) url.searchParams.set('token', token);
}
const ws = new WebSocket(url.toString());
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'subscribe', scope: 'all', ids }));
};
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'batchUpdate') {
    for (const u of msg.updates) {
      for (const s of u.samples || []) {
        updateServer(u.serverId, s.data || s.payload || s.metrics || {});
      }
    }
  }
};
```

**示例（subscribe=serverId，实时推送）**：

```js
const url = new URL('wss://status.example.com/api/ws');
url.searchParams.set('subscribe', 'server-001');
const sameHost = url.host === location.host;
if (!sameHost) {
  const token = localStorage.getItem('jwt_token');
  if (token) url.searchParams.set('token', token);
}
const ws = new WebSocket(url.toString());
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'batchUpdate') {
    for (const u of msg.updates) {
      for (const s of u.samples) {
        updateServer(u.serverId, s.data || s.payload || s.metrics || {});
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
interface DiskIoMetrics {
  read_bps: number;   // B/s
  write_bps: number;  // B/s
  read_iops: number;
  write_iops: number;
  await_ms: number;
  util: number;       // %
}

interface LatencyWindowPoint {
  ts: number;
  ct?: number | null | false;
  cu?: number | null | false;
  cm?: number | null | false;
  bd?: number | null | false;
}

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
  wss_report_interval: number;
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
  ping_ct: number | null | false;
  ping_cu: number | null | false;
  ping_cm: number | null | false;
  ping_bd: number | null | false;
  loss_ct: number | null | false;
  loss_cu: number | null | false;
  loss_cm: number | null | false;
  loss_bd: number | null | false;
  ping?: LatencyWindowPoint[]; // 仅 /api/servers 的列表项返回；三网详情关闭时为空数组
  loss?: LatencyWindowPoint[]; // 仅 /api/servers 的列表项返回；三网详情关闭时为空数组
  ram_total: number;
  ram_used: number;
  swap_total: number;
  swap_used: number;
  disk_total: number;
  disk_used: number;
  disk?: DiskIoMetrics; // 磁盘 IO；旧数据可能缺失
  cpu_cores: number;
  cpu_info: string;
  gpu_info: Array<{ id: string; name: string; info: number | null }> | string;
  arch: string;
  os: string;
  kernel_version: string;
  region: string;
  ip_v4: '0' | '1'; // 公共 REST 接口仅返回 IPv4 可达性
  ip_v6: '0' | '1'; // 公共 REST 接口仅返回 IPv6 可达性
  boot_time: string;
  agent_version?: string;
  last_updated: number;
  timestamp: number;
  is_online?: boolean;
  sysConfig?: SysConfig;
}

interface HistoryMetricRow extends Partial<Server> {
  timestamp: number;
  disk_read_bps?: number;
  disk_write_bps?: number;
  disk_read_iops?: number;
  disk_write_iops?: number;
  disk_await_ms?: number;
  disk_util?: number;
  disk?: DiskIoMetrics;
}

interface SysConfig {
  show_price?: boolean;
  show_expire?: boolean;
  show_tf?: boolean;
  long_history_points?: number;
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
  theme_options: Record<string, unknown>;
  verified: boolean;
  turnstile_verified: string | null;
  frontend_ws_timeout_minutes: number;
  long_history_points: number;
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
    samples: Array<{
      ts: number;
      data?: Partial<Server>;
      payload?: Partial<Server>;
      metrics?: Partial<Server>;
    }>;
  }>;
}
```
