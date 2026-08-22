# CF-Server-Monitor 全局 API 文档

> 面向 CF-Server-Monitor 项目维护者和集成方的全局 REST / WebSocket API 参考。
> 本文档覆盖 Workers 全部公开端点、管理端端点、维护端点、鉴权机制、错误码、数据结构与 WebSocket 实时推送协议。
>
> **Base URL**：`https://<your-worker-domain>`（部署后由 Cloudflare Workers 提供）
>
> **最后核对源码日期**：`2026-07-26`
>
> **修订标记约定**：自 `2026-07-26` 起，已过期但有迁移参考价值的说明使用删除线保留，紧随其后给出当前实现。
>
> **统一响应头**：
>
> - `Content-Type: application/json; charset=utf-8`（除特别说明外）
> - CORS：当 `CORS_ALLOWED_ORIGINS` 环境变量配置了允许的源时，会附带 `Access-Control-Allow-Origin / Allow-Credentials / Vary: Origin`。
> - `X-Cache: HIT | MISS`：仅出现在 `/api/history/all` 响应中。

***

## 目录

- [0. 通用规范](#0-通用规范)
  - [0.1 鉴权机制](#01-鉴权机制)
  - [0.2 Turnstile 人机验证](#02-turnstile-人机验证)
  - [0.3 统一响应格式](#03-统一响应格式)
  - [0.4 统一错误码](#04-统一错误码)
  - [0.5 限流与配额](#05-限流与配额)
  - [0.6 CORS](#06-cors)
- [1. 探针上报接口](#1-探针上报接口)
  - [1.1](#11-post-update---指标上报agent-入口) [`POST /update`](#11-post-update---指标上报agent-入口) [- 指标上报（Agent 入口）](#11-post-update---指标上报agent-入口)
- [2. 公开 API（前端/管理端共用）](#2-公开-api前端管理端共用)
  - [2.1](#21-get-apiconfig---获取站点配置) [`GET /api/config`](#21-get-apiconfig---获取站点配置) [- 获取站点配置](#21-get-apiconfig---获取站点配置)
  - [2.2](#22-get-apiservers---获取服务器列表首页) [`GET /api/servers`](#22-get-apiservers---获取服务器列表首页) [- 获取服务器列表（首页）](#22-get-apiservers---获取服务器列表首页)
  - [2.3](#23-get-apiserver---获取单台服务器详情) [`GET /api/server`](#23-get-apiserver---获取单台服务器详情) [- 获取单台服务器详情](#23-get-apiserver---获取单台服务器详情)
  - [2.4](#24-get-apihistoryall---获取历史指标) [`GET /api/history/all`](#24-get-apihistoryall---获取历史指标) [- 获取历史指标](#24-get-apihistoryall---获取历史指标)
  - [2.5](#25-get-apiws---websocket-实时推送) [`GET /api/ws`](#25-get-apiws---websocket-实时推送) [- WebSocket 实时推送](#25-get-apiws---websocket-实时推送)
  - [2.6](#26-get-theme---获取主题商店数据) [`GET /theme`](#26-get-theme---获取主题商店数据) [- 获取主题商店数据](#26-get-theme---获取主题商店数据)
  - [2.7](#27-前端与主题代理) [前端与主题代理](#27-前端与主题代理)
- [3. 管理端 API（鉴权）](#3-管理端-api鉴权)
  - [3.1](#31-post-adminapi---管理操作入口) [`POST /admin/api`](#31-post-adminapi---管理操作入口) [- 管理操作入口](#31-post-adminapi---管理操作入口)
  - [3.2](#32-action-login---登录) [`action: login`](#32-action-login---登录) [- 登录](#32-action-login---登录)
  - [3.3](#33-action-get_settings---读取全部设置) [`action: get_settings`](#33-action-get_settings---读取全部设置) [- 读取全部设置](#33-action-get_settings---读取全部设置)
  - [3.4](#34-action-list---列出全部服务器含在线统计) [`action: list`](#34-action-list---列出全部服务器含在线统计) [- 列出全部服务器（含在线/统计）](#34-action-list---列出全部服务器含在线统计)
  - [3.5](#35-action-d1_usage---d1--workers--durable-objects-用量) [`action: d1_usage`](#35-action-d1_usage---d1--workers--durable-objects-用量) [- D1 / Workers / Durable Objects 用量](#35-action-d1_usage---d1--workers--durable-objects-用量)
  - [3.6](#36-action-save_settings---保存设置) [`action: save_settings`](#36-action-save_settings---保存设置) [- 保存设置](#36-action-save_settings---保存设置)
  - [3.6.1](#361-action-start_theme_preview---生成主题预览授权) [`action: start_theme_preview`](#361-action-start_theme_preview---生成主题预览授权) [- 生成主题预览授权](#361-action-start_theme_preview---生成主题预览授权)
  - [3.6.2](#362-action-clear_theme_preview_auth---清除主题预览授权) [`action: clear_theme_preview_auth`](#362-action-clear_theme_preview_auth---清除主题预览授权) [- 清除主题预览授权](#362-action-clear_theme_preview_auth---清除主题预览授权)
  - [3.7](#37-action-add---新增服务器) [`action: add`](#37-action-add---新增服务器) [- 新增服务器](#37-action-add---新增服务器)
  - [3.8](#38-action-edit---修改服务器信息) [`action: edit`](#38-action-edit---修改服务器信息) [- 修改服务器信息](#38-action-edit---修改服务器信息)
  - [3.9](#39-action-delete---删除服务器) [`action: delete`](#39-action-delete---删除服务器) [- 删除服务器](#39-action-delete---删除服务器)
  - [3.10](#310-action-batch_delete---批量删除) [`action: batch_delete`](#310-action-batch_delete---批量删除) [- 批量删除](#310-action-batch_delete---批量删除)
  - [3.11](#311-action-save_order---保存服务器排序) [`action: save_order`](#311-action-save_order---保存服务器排序) [- 保存服务器排序](#311-action-save_order---保存服务器排序)
  - [3.12](#312-action-send_test_notification---发送测试通知) [`action: send_test_notification`](#312-action-send_test_notification---发送测试通知) [- 发送测试通知](#312-action-send_test_notification---发送测试通知)
  - [3.13](#313-action-export_servers---导出服务器) [`action: export_servers`](#313-action-export_servers---导出服务器) [- 导出服务器](#313-action-export_servers---导出服务器)
  - [3.14](#314-action-import_servers---导入服务器) [`action: import_servers`](#314-action-import_servers---导入服务器) [- 导入服务器](#314-action-import_servers---导入服务器)
- [4. 系统维护端点](#4-系统维护端点)
  - [4.1](#41-post-updatedatabase---数据库迁移) [`POST /updateDatabase`](#41-post-updatedatabase---数据库迁移) [- 数据库迁移](#41-post-updatedatabase---数据库迁移)
  - [4.2](#42-post-clearhistory---清空历史数据) [`POST /clearHistory`](#42-post-clearhistory---清空历史数据) [- 清空历史数据](#42-post-clearhistory---清空历史数据)
  - [4.3](#43-get-__dohealth---durable-object-健康检查) [`GET /__do/health`](#43-get-__dohealth---durable-object-健康检查) [- Durable Object 健康检查](#43-get-__dohealth---durable-object-健康检查)
- [5. 数据结构](#5-数据结构)
  - [5.1 Server 对象](#51-server-对象)
  - [5.2 Metrics 对象（探针上报 payload）](#52-metrics-对象探针上报-payload)
  - [5.3 History Row 对象](#53-history-row-对象)
  - [5.4 Settings 对象](#54-settings-对象)
  - [5.5 WebSocket 消息](#55-websocket-消息)
- [6. 定时任务 (Cron)](#6-定时任务-cron)
- [7. 错误码速查表](#7-错误码速查表)
- [8. 完整 cURL 示例](#8-完整-curl-示例)
- [9. 版本与变更说明](#9-版本与变更说明)

***

## 0. 通用规范

### 0.1 鉴权机制

项目使用 **三套并行的鉴权机制**，按接口范围区分使用。所有请求还依赖非空的 `env.API_SECRET`；未配置时 Worker 会在路由处理前返回 `400 { "error": "API_SECRET is required", "code": 400 }`。

#### A. 探针 Secret（Agent → Worker）

- **使用位置**：`POST /update`
- **方式**：请求体字段 `secret`
- **值**：必须等于 Worker 环境变量 `API_SECRET`
- **失败返回**：`401 { "error": "Invalid secret", "code": 401 }`

#### B. Basic Auth（管理登录 → JWT）

- **使用位置**：`POST /admin/api` 的 `action: login`
- **方式**：请求体字段 `username` / `password`（后端内部组装 `Basic base64(user:pass)` 进行校验）
- **校验顺序**：
  1. 若 `site_options.password` 已设置为 PBKDF2 格式 → 按 `pbkdf2_sha256$iterations$salt$hash` 校验
  2. 若 `site_options.password` 为旧版 32 位 MD5 → 按 MD5 兼容校验，成功后自动升级为 PBKDF2
  3. 若 `site_options.password` 未设置或为空 → 与 `API_SECRET` 直接比对
  4. 用户名：若 `site_options.username` 已设置则用之，否则回退为 `admin`
- **失败返回**：`401 { "error": "Invalid username or password", "code": 401 }`

#### C. JWT Bearer（管理操作 → 后续管理请求）

- **使用位置**：所有非 `login` 的 `POST /admin/api`、`POST /updateDatabase`、`POST /clearHistory`
- **方式**：`Authorization: Bearer <token>` Header
- **Token 签发**：`HS256` JWT，默认有效期 **604800 秒（7 天）**
- **签名密钥**（优先级）：
  1. `site_options.jwt_secret`（长度 ≥ 32）
  2. `API_SECRET`（不够 32 字符时 `padEnd` 补 `'x'` 后取前 64 位）
  3. 回退常量：`'default_jwt_secret_for_server_monitor'`
- **Payload 字段**：
  ```json
  { "sub": "admin", "iat": <unix>, "exp": <unix + 604800> }
  ```
- **失败返回**：`401 { "error": "Unauthorized", "code": 401 }`

> **缓存提示**：管理端登录成功后，前端应将 `token` 存于 `localStorage`，并对所有非登录的 `admin/api` 请求自动加上 `Authorization: Bearer <token>` Header。
>
> **2026-07-26 修订**：加载站点设置时，后端会在缺少有效 `jwt_secret` 时生成并持久化一个 32 字节随机密钥。因此第 2、3 级回退主要用于数据库加载异常等兜底场景。

#### D. WebSocket JWT（私有站点前端实时推送）

- **使用位置**：`GET /api/ws`，仅当 `site_options.is_public !== 'true'` 时强制校验
- **认证来源**（任一通过即可）：
  - `Authorization: Bearer <token>`
  - `Cookie: cfsm_auth=<token>`
  - 查询参数：`token=<token>`、`auth_token=<token>` 或 `ws_token=<token>`
- **失败返回**：`401 { "error": "Unauthorized", "code": 401 }`

浏览器原生 WebSocket 不能自定义 `Authorization` Header。内置前端同域连接走 `cfsm_auth` Cookie，跨域连接才追加 `token=<jwt>` 查询参数。服务端会在转发到 Durable Object 前完成私有站点权限校验；公开站点不要求 JWT。

### 0.2 Turnstile 人机验证

当 `site_options.turnstile_enabled === 'true'` 时，**所有** **`/api/*`** **与** **`/admin/api`** **公共接口**（除了下方 bypass 列表）都需要先验证 Cloudflare Turnstile Token。

**Bypass 列表**（无需 Turnstile）：

- `/admin/api`（`/admin/api` 走另一套 Turnstile：见 `action: login`）
- `/api/ws`（WebSocket 升级）
- `/api/config` 在 **不携带** `X-Turnstile-Token` 与 `X-Turnstile-Verified` 时（用于初始化判断是否需要验证）

**验证流程**：

1. **首次访问**：客户端从 `/api/config` 拿到 `turnstile_site_key`。
2. **前端渲染** Turnstile 组件 → 拿到一次性 `token`。
3. **后续请求**在 Header 增加：
   ```
   X-Turnstile-Token: <token from cloudflare>
   ```
4. Worker 用 `site_options.turnstile_secret_key` 调用 `https://challenges.cloudflare.com/turnstile/v0/siteverify` 验证。
5. ~~**验证成功后**，Worker 通过 `X-Turnstile-Verified` 这个 **加密 Header** 给客户端发“已验证凭证”。~~ **2026-07-26 修订**：当前实现通过 `/api/config` 响应体的 `turnstile_verified` 字段返回 AES-GCM 加密凭证，有效期 **3600 秒**。代码会计算同名响应 Header 的值，但当前未实际写入 Header。
6. 客户端也可以把 `X-Turnstile-Verified` 再次带回，Worker 会优先验证该 Header（验证有效期）。

**相关请求/响应 Header**：

| Header                 | 方向              | 含义                                                                                 |
| ---------------------- | --------------- | ---------------------------------------------------------------------------------- |
| `X-Turnstile-Token`    | Client → Server | 当次 Turnstile token（明文）                                                             |
| `X-Turnstile-Verified` | Client → Server；响应方向当前仅在 `/api/config` Body 返回 | AES-GCM 加密的 `{ expires: <unix+3600>, verified: true, timestamp: <ms> }`，base64 字符串 |

**失败返回**：`403 { "error": "Turnstile verification failed", "code": 403 }`

### 0.3 统一响应格式

**成功响应**：

```json
{
  // 业务字段，结构因接口而异；不保证包含 success
  "...": "..."
}
```

> 注：项目里的成功响应是直接 `JSON.stringify` 业务对象，**没有固定的 `success` 或 `code` 字段**。~~HTTP 状态码始终为 `200`。~~ **2026-07-26 修订**：大多数成功响应为 `200`，新版探针配置无变化时为 `204`，WebSocket 升级为 `101`。

**成功响应特例**：

- `POST /update` 的旧版协议、流量修正确认或配置生成兜底 → 纯文本 `OK`（`Content-Type: text/plain`）；新版协议也可能返回 QueryParam 配置或 `update=1`
- 新版探针配置 MD5 一致、没有待确认修正且无需自动更新 → `204 No Content`
- WebSocket 升级 → `101 Switching Protocols`

**常见错误响应**：

```json
{
  "error": "human readable message",
  "code": 400
}
```

> ~~所有错误都使用 `{error, code}`，且 `code` 始终是 HTTP 状态码镜像。~~ **2026-07-26 修订**：`src/utils/errors.js` 创建的大多数 JSON 错误符合该结构；历史表缺列的 `409` 使用 `{message}`，部分 WebSocket/主题/前端错误为纯文本，数据库维护还可能以 HTTP `200` 返回业务 `success: false`。

### 0.4 统一错误码

| code | 含义                    | 常见场景                                               |
| ---- | --------------------- | -------------------------------------------------- |
| 400  | Bad Request           | 参数缺失/类型错/UUID 不合法/未知 action                        |
| 401  | Unauthorized          | 缺/错 token、账号密码错、站点非公开且未登录                          |
| 403  | Forbidden             | Turnstile 验证失败                                     |
| 404  | Not Found             | 服务器 ID 不存在                                         |
| 409  | Conflict              | `databaseUpgradeRequired`，需先调用 `/updateDatabase` |
| 500  | Internal Server Error | DB 异常等未捕获错误                                        |
| 503  | Service Unavailable   | WebSocket 不可用（未绑定 DO）                              |

### 0.5 限流与配额

- ~~Cloudflare Workers / D1 固定限制为 D1 500 万行读、10 万行写、Workers 10 万次请求/日。~~ **2026-07-26 修订**：配额取决于 Cloudflare 当前套餐与计费策略，不属于本项目 API 的固定契约，应以 Cloudflare Dashboard 和官方文档为准。
- `/admin/api?action=d1_usage` 可查询当前账户 UTC 当日用量与 UTC 昨日用量。

### 0.6 CORS

环境变量 `CORS_ALLOWED_ORIGINS`，**逗号分隔**的源白名单，例如：

```
CORS_ALLOWED_ORIGINS=https://status.example.com,https://admin.example.com
```

- 当请求 `Origin` 命中白名单 → 响应带 `Access-Control-Allow-Origin: <origin>`、`Access-Control-Allow-Credentials: true`、`Vary: Origin`。
- 预检请求 `OPTIONS` → 直接返回 `204`，并回显 `Access-Control-Request-Method` / `Access-Control-Request-Headers`，缓存 86400 秒。
- 未配置或未命中 → 不会下发 CORS Header，浏览器侧会被同源策略拦截。
- WebSocket Durable Object 是例外：未配置白名单时握手响应使用 `Access-Control-Allow-Origin: *`；配置了非空白名单后才按 `Origin` 拒绝不匹配的连接。

***

## 1. 探针上报接口

### 1.1 `POST /update` - 指标上报（Agent 入口）

> **调用方**：服务器侧探针（[Bash install.sh](./public/install.sh) / [Windows cf-server-monitor.ps1](./public/cf-server-monitor.ps1)）。~~旧链接使用 `../public` 且指向不存在的 `.pyw` 文件。~~（2026-07-26 修订）
> **鉴权**：`secret` 字段 == `env.API_SECRET`
> **Turnstile**：不参与

**Request**

- Method：`POST`
- WebSocket：`GET /update` + `Upgrade: websocket`，公网 URL 形如 `wss://status.example.com/update`
- Path：`/update`
- Headers：
  ```
  Content-Type: application/json
  X-Agent-Version: <探针版本号>
  X-Agent-Config-Schema: 5
  X-Agent-Config-Md5: <最后成功应用的配置 MD5，首次为 none>
  ```
  动态配置请求头为新版探针使用的可选字段；当前新 Go Agent 使用 schema `5`。schema `3` / `4` 仍按旧兼容配置返回，未携带时保持旧版响应协议。

  WebSocket 握手只能使用 `GET + Upgrade`，这是 WebSocket 协议限制；后端仍通过同一个 `/update` 路径区分 `POST` 与 `wss`。握手成功后服务端先发送：

  ```json
  { "type": "hello", "ts": 1737638340000, "protocol": "update" }
  ```

  WebSocket 上报消息兼容下方 POST JSON body，也支持包一层 `type: "update"`：

  ```json
  {
    "type": "update",
    "id": "9b2c4d3e-1a2b-4c5d-9e8f-7a6b5c4d3e2f",
    "secret": "<API_SECRET>",
    "payload": {
      "metrics": { "...": "metrics" }
    }
  }
  ```

  第一条有效上报必须携带 `id` 与 `secret`。连接认证成功后，后续消息可以省略 `id` 与 `secret`；如果后续消息显式携带不同 `id` 或错误 `secret`，服务端会发送错误帧并关闭连接。
- Body（JSON）：
  ```json
  {
    "id": "9b2c4d3e-1a2b-4c5d-9e8f-7a6b5c4d3e2f",
    "secret": "<API_SECRET>",
    "metrics": {
      "cpu": "12.34",
      "ram_total": "8192",
      "ram_used": "3700",
      "swap_total": "2048",
      "swap_used": "100",
      "disk_total": "102400",
      "disk_used": "32000",
      "disk": {
        "read_bps": 4096,
        "write_bps": 2048,
        "read_iops": 12,
        "write_iops": 8,
        "await_ms": 1.5,
        "util": 3.2
      },
      "load_avg": "0.10 0.20 0.30",
      "boot_time": "1700000000000",
      "net_rx": "12345678",
      "net_tx": "87654321",
      "net_rx_monthly": "1073741824",
      "net_tx_monthly": "536870912",
      "net_in_speed": "1024",
      "net_out_speed": "512",
      "os": "Ubuntu 22.04",
      "arch": "x86_64",
      "kernel_version": "6.8.0-36-generic",
      "cpu_info": "Intel(R) Xeon(R) CPU",
      "cpu_cores": "4",
      "gpu_info": [
        { "id": "0", "name": "NVIDIA GeForce RTX 3060", "info": 12.5 }
      ],
      "processes": "256",
      "tcp_conn": "32",
      "udp_conn": "4",
      "ip_v4": "203.0.113.10",
      "ip_v6": "2001:db8::10",
      "ping_ct": "23",
      "ping_cu": "25",
      "ping_cm": "30",
      "ping_bd": "40",
      "loss_ct": "0",
      "loss_cu": "0",
      "loss_cm": "0",
      "loss_bd": "0"
    }
  }
  ```

  新版探针也可以一次上报多个采集样本，后端兼容旧的单条 `metrics` 格式。`samples` 还兼容别名 `batch`；每个元素可直接是指标对象，也可放在 `metrics`、`data` 或 `payload` 中。单次最多保留时间排序后的最后 300 个样本。批量格式示例：

  ```json
  {
    "id": "9b2c4d3e-1a2b-4c5d-9e8f-7a6b5c4d3e2f",
    "secret": "<API_SECRET>",
    "metrics": { "...": "latest metrics, kept for compatibility" },
    "samples": [
      { "ts": 1737638340000, "metrics": { "...": "metrics at this timestamp" } },
      { "ts": 1737638341000, "metrics": { "...": "metrics at this timestamp" } }
    ],
    "collect_interval": 1,
    "report_interval": 60,
    "wss_report_interval": 2
  }
  ```

**字段说明（metrics）**：

> ~~下表“必填”表示服务端会逐字段拒绝缺失值。~~ **2026-07-26 修订**：服务端只要求存在结构有效的 `metrics`，或至少一个有效的 `samples`/`batch` 元素；不会逐字段校验。数值字段同时接受 JSON string/number，缺失或无法解析的指标大多按 `0`、空字符串或 `null` 入库。下表“是”表示官方探针的常规上报字段。

| 字段               | 类型           | 单位  | 必填 | 说明                                          |
| ---------------- | ------------ | --- | -- | ------------------------------------------- |
| `cpu`            | string\|number | %   | 是  | CPU 占用率，保留 2 位小数                            |
| `ram_total`      | string\|number | MB  | 是  | 内存总容量                                       |
| `ram_used`       | string\|number | MB  | 是  | 内存已用                                        |
| `swap_total`     | string\|number | MB  | 是  | Swap 总容量                                    |
| `swap_used`      | string\|number | MB  | 是  | Swap 已用                                     |
| `disk_total`     | string\|number | MB  | 是  | 磁盘总容量                                       |
| `disk_used`      | string\|number | MB  | 是  | 磁盘已用                                        |
| `disk`           | object       | -   | 否  | 磁盘 IO 指标。缺失、不是 object，或 6 个子字段全为 0 时，API / WebSocket 不返回 `disk` 字段；存在至少一个非 0 子字段时，缺失或无法解析的子字段按 0 处理。子字段：`read_bps`、`write_bps`、`read_iops`、`write_iops`、`await_ms`、`util` |
| `load_avg`       | string       | -   | 是  | 三个浮点，空格分隔                                   |
| `boot_time`      | string\|number | 毫秒  | 是  | 系统启动时间（Unix ms）                             |
| `net_rx`         | string\|number | 字节  | 是  | 累计接收字节                                      |
| `net_tx`         | string\|number | 字节  | 是  | 累计发送字节                                      |
| `net_rx_monthly` | string\|number | 字节  | 是  | 当月累计下行                                      |
| `net_tx_monthly` | string\|number | 字节  | 是  | 当月累计上行                                      |
| `net_in_speed`   | string\|number | B/s | 是  | 实时下行速度                                      |
| `net_out_speed`  | string\|number | B/s | 是  | 实时上行速度                                      |
| `os`             | string       | -   | 是  | 操作系统                                        |
| `arch`           | string       | -   | 是  | 系统架构                                        |
| `kernel_version` | string       | -   | 是  | 内核版本                                      |
| `cpu_info`       | string       | -   | 是  | CPU 型号                                      |
| `cpu_cores`      | string\|number | -   | 是  | 逻辑核心数                                       |
| ~~`gpu`~~        | number\|null | %   | 否  | ~~独立 GPU 占用字段。~~ **2026-07-26 修订**：旧版探针仍可能发送，但后端没有独立 `gpu` 列，不会持久化，也不会在 API 中返回 |
| `gpu_info`       | array\|null | - | 否 | 新版格式为 `[{id,name,info}]`；`info` 是占用率。无 GPU 时可为 `null`，入库后会序列化为 JSON 字符串 |
| `processes`      | string\|number | -   | 是  | 进程数                                         |
| `tcp_conn`       | string\|number | -   | 是  | TCP 活跃连接数                                   |
| `udp_conn`       | string\|number | -   | 是  | UDP 套接字数                                    |
| `ip_v4`          | string\|number | -   | 是  | 公网 IPv4 地址；`0` 表示不可达；兼容旧探针 `1` 表示可达但未上报地址 |
| `ip_v6`          | string\|number | -   | 是  | 公网 IPv6 地址；`0` 表示不可达；兼容旧探针 `1` 表示可达但未上报地址 |
| `ping_ct`        | string\|number\|false\|null | ms  | 否  | 电信节点延时；空值表示未取到，`false` / `"false"` 表示禁用 |
| `ping_cu`        | string\|number\|false\|null | ms  | 否  | 联通节点延时                                      |
| `ping_cm`        | string\|number\|false\|null | ms  | 否  | 移动节点延时                                      |
| `ping_bd`        | string\|number\|false\|null | ms  | 否  | BGP 节点延时                                    |
| `loss_ct`        | string\|number\|false\|null | %   | 否  | 电信丢包率                                       |
| `loss_cu`        | string\|number\|false\|null | %   | 否  | 联通丢包率                                       |
| `loss_cm`        | string\|number\|false\|null | %   | 否  | 移动丢包率                                       |
| `loss_bd`        | string\|number\|false\|null | %   | 否  | BGP 丢包率                                     |

**Response**

- 旧版探针（未携带受支持的 `X-Agent-Config-Schema`）：返回 `200 OK`：
  ```
  OK
  ```
  （`Content-Type: text/plain`）
- 新版探针且配置 MD5 一致、没有待确认流量修正且无需自动更新：返回 `204 No Content`，不包含响应体。
- 新版探针且配置 MD5 不一致，或仍有待确认流量修正：返回 `200 OK`，响应头携带当前
  `X-Agent-Config-Schema` 与 `X-Agent-Config-Md5`，响应体以固定顺序的完整 QueryParam 配置开头：
  ```text
  collect_interval=2&report_interval=60&reset_day=1&schema_version=5&custom_ct=gd-ct-dualstack.ip.zstaticcdn.com&custom_cu=gd-cu-dualstack.ip.zstaticcdn.com&custom_cm=gd-cm-dualstack.ip.zstaticcdn.com&custom_bd=ip.zstaticcdn.com&interface=&connection_mode=auto&wss_report_interval=2
  ```
  （`Content-Type: application/x-www-form-urlencoded; charset=utf-8`）
- ~~动态配置包含 `traffic_calc_type`、`traffic_limit`、`auto_update` 等全部探针运行参数。~~ **2026-07-26 修订，2026-07-31 更新，2026-08-15 更新，2026-08-18 更新，2026-08-19 更新**：schema `3` 不包含 `connection_mode`；schema `4` 增加 `connection_mode`，并保持原有序列化与 MD5 计算不变；schema `5` 在 WSS 全局开启且服务器 `connection_mode=auto` 时追加 `wss_report_interval`（`1-5` 秒，默认 `2`），并将 `collect_interval=0` 或大于 WSS 间隔的值规范为 WSS 间隔。待应用的 `rx_correction`、`tx_correction` 会追加到响应体，但不参与配置 MD5；启用自动更新且版本不一致时追加 `update=1`。
- 探针应用流量修正后，可在下一次 `POST /update` 顶层回传 `rx_correction` / `tx_correction`。值匹配时后端清空待修正字段并直接返回纯文本 `OK`，本次请求不要求 `metrics`。
- 失败：
  ```json
  { "error": "Invalid secret", "code": 401 }
  { "error": "Server not found", "code": 404 }
  ```

**WebSocket 上报响应 / 错误**

- 握手失败：
  - `503 { "error": "WebSocket not enabled", "code": 503 }`：未绑定 `METRICS_BROADCASTER` Durable Object
  - `426 Expected WebSocket upgrade request`：`GET /update` 未携带 `Upgrade: websocket`
  - `403 Forbidden`：设置了 WebSocket `Origin`，且不在 `CORS_ALLOWED_ORIGINS` 中
  - `500 { "error": "WebSocket error", "code": 500 }`：Worker 转发至 DO 失败
- 上报成功：服务端发送 ack，不关闭连接。
  ```json
  { "type": "ack", "ts": 1737638343000, "persisted": true, "nextD1WriteAfterMs": 60000, "nextWssReportAfterMs": 60000 }
  ```
  `persisted` 表示本条消息是否触发 D1 历史写入；`nextD1WriteAfterMs` 是距离下一次允许写入 D1 的最短等待时间。WSS 首条成功指标会立即写入一次 D1，后续按该服务器 `report_interval` 控制写入频率（允许值沿用配置：`30/60/120/180` 秒；异常回退 `60` 秒）。`nextWssReportAfterMs` 是服务端建议的下一次 WSS 上报间隔：有前端实时订阅时使用服务器 `wss_report_interval`；无前端访问时使用 `report_interval`，但最低为 `60` 秒，不区分资源告警缓存是否活跃。缺失或非法的 WSS 间隔回退为 `2` 秒。
  新版 WSS Agent 可在握手 URL query 中携带 `config_schema=5` / `config_md5=<md5>`，也兼容握手 Header `X-Agent-Config-Schema: 5` 与 `X-Agent-Config-Md5` 记录当前配置状态；当某次上报消息携带 `config_schema: 5` / `config_md5` 时，ack 会同时返回动态配置协商字段。schema `3` / `4` Agent 仍会收到各自版本的兼容配置：
  ```json
  {
    "type": "ack",
    "ts": 1737638343000,
    "persisted": false,
    "nextD1WriteAfterMs": 30000,
    "nextWssReportAfterMs": 2000,
    "config_schema": 5,
    "config_md5": "b4d7c0d...",
    "has_config": true,
    "body": "collect_interval=2&report_interval=60&reset_day=1&schema_version=5&custom_ct=gd-ct-dualstack.ip.zstaticcdn.com&custom_cu=gd-cu-dualstack.ip.zstaticcdn.com&custom_cm=gd-cm-dualstack.ip.zstaticcdn.com&custom_bd=&interface=&connection_mode=auto&wss_report_interval=2",
    "config_body": "collect_interval=2&report_interval=60&reset_day=1&schema_version=5&custom_ct=gd-ct-dualstack.ip.zstaticcdn.com&custom_cu=gd-cu-dualstack.ip.zstaticcdn.com&custom_cm=gd-cm-dualstack.ip.zstaticcdn.com&custom_bd=&interface=&connection_mode=auto&wss_report_interval=2",
    "payload": {
      "collect_interval": 2,
      "report_interval": 60,
      "reset_day": 1,
      "schema_version": 5,
      "custom_ct": "gd-ct-dualstack.ip.zstaticcdn.com",
      "custom_cu": "gd-cu-dualstack.ip.zstaticcdn.com",
      "custom_cm": "gd-cm-dualstack.ip.zstaticcdn.com",
      "custom_bd": "",
      "interface": "",
      "connection_mode": "auto",
      "wss_report_interval": 2,
      "config_md5": "b4d7c0d..."
    }
  }
  ```
  `has_config:false` 表示当前 MD5 一致且没有待确认流量修正；`has_config:true` 时 Agent 应优先按 `body` / `config_body` 复用 POST 动态配置解析逻辑，或读取结构化 `payload`。官方 WSS Agent 默认仅在首次上报、约每 60 秒或本地配置 MD5 变化时携带 `config_schema` / `config_md5`；本次消息未携带这些字段时，ack 可以只包含 `persisted` / `nextD1WriteAfterMs` / `nextWssReportAfterMs` 等基础字段，不携带配置协商字段。若存在待确认流量修正，`body` / `config_body` 与 `payload` 会追加 `rx_correction` / `tx_correction`，Agent 应应用后通过 WSS 或 POST 回传确认。
- 流量修正确认成功：
  ```json
  { "type": "ack", "ts": 1737638343000, "correction": true }
  ```
- 上报失败：服务端先发送错误帧，然后使用 close code `1008` 关闭 WebSocket；close reason 与 `error` 一致。
  ```json
  { "type": "error", "ts": 1737638343000, "error": "Invalid secret", "code": 401 }
  ```
  常见错误：

  | code | error | 是否查询 D1 | 说明 |
  | ---- | ----- | ---------- | ---- |
  | 400 | `Invalid JSON` | 否 | WebSocket 消息不是合法 JSON |
  | 400 | `Invalid report payload` | 否 | 消息不是对象，或 `type:"update"` 的 `payload` 非对象 |
  | 400 | `Invalid server ID` | 否 | `id` 为空、过长或包含非法字符 |
  | 401 | `Invalid secret` | 否 | 第一条有效上报未携带正确 `secret`；认证后显式发送错误 `secret` 也会关闭连接 |
  | 403 | `Server ID changed` | 否 | 已认证连接切换为另一个 `id` |
  | 404 | `Server not found` | 是 | `id` 格式合法，但 `servers` 表不存在该服务器 |
  | 400 | `Missing history_partition_id` | 是 | 服务器历史分区未初始化，且自动优化后仍不可用 |
  | 400 | `Missing metrics` | 视认证状态而定 | 认证成功后没有有效 `metrics` / `samples` / `batch` |
  | 400 | `Invalid correction` | 否 | `rx_correction` / `tx_correction` 格式非法 |

> Agent 收到任意 `type:"error"` 或 close code `1008` 后，应停止当前 WSS 连接和 POST fallback 上报，至少等待 `120` 秒后再重新连接或重试 POST，避免认证/配置错误时持续消耗额度。

**WebSocket 计费注意**

- 建立 `wss://.../update` 连接需要一次 `GET + Upgrade`，该握手按一次 Workers request 计入。
- 连接建立后的 Agent 上报消息由 Durable Object 标准 WebSocket API 接收，不使用 Hibernation API 接管 `/update` 连接；它们作为 Durable Objects WebSocket incoming messages 计量，Cloudflare 计费口径按 `20:1` 折算为 DO requests。
- 该模式避免高频 Agent 指标消息表现为 hibernation wakeup，但只要 Agent 长连接存在，DO 会保持非休眠状态并产生 duration（GB-s）。前端订阅 `/api/ws` 仍使用 WebSocket Hibernation API。
- 因此，Agent 应保持长连接；不要每次采样都断开重连。错误 `id` / `secret` 当前在 DO 消息阶段返回错误帧并关闭，避免每次上报都走 Worker 401。

**副作用**

1. `POST /update` 的 `metrics_history` 只写入本次请求中最新的一个样本；`wss://.../update` 首条成功指标立即写入一次，后续按服务器 `report_interval` 最多写入一次 D1。
2. 触发 Durable Object `MetricsBroadcaster` 内部广播，统一发送 `{type:"batchUpdate", ts, updates:[...]}` 格式，前端按样本时间逐个回放。
3. 写入 `request.cf.country`（或 `cf-ipcountry` Header）作为该条记录的 `region` 字段。~~服务端会统一转大写。~~ **2026-07-26 修订**：当前按原值入库；Cloudflare 的国家代码通常为大写，但自定义回退 Header 不会被规范化。

***

## 2. 公开 API（前端/管理端共用）

> ~~以下接口除 `/api/ws` 外，若 `site_options.is_public !== 'true'` 则必须携带 JWT。~~ **2026-07-26 修订**：`/api/servers`、`/api/server`、`/api/history/all` 在私有站点需要 JWT；`/api/config`、`/api/ws`、`/theme` 无论站点是否公开均可访问。**2026-08-19 修订**：私有站点的 `/api/ws` 也需要通过 WebSocket JWT 认证，公开站点仍可匿名连接。
> 命中 Turnstile 时需带 `X-Turnstile-Token` 或 `X-Turnstile-Verified`。

### 2.1 `GET /api/config` - 获取站点配置

**Request**

- Method：`GET`
- Path：`/api/config`
- Headers（可选）：
  ```
  X-Turnstile-Token: <token>   # 当携带时，验证后会在响应体返回 turnstile_verified
  X-Turnstile-Verified: <encrypted>
  ```

**Response** `200 OK`

```json
{
  "version": "2.8.0 Beta",
  "is_public": true,
  "authorization": false,
  "turnstile_enabled": true,
  "turnstile_login_enabled": true,
  "turnstile_site_key": "1x00000000000000000000AA",
  "site_title": "My Server Monitor",
  "display_mode": "bar",
  "verified": false,
  "turnstile_verified": null,
  "theme_options": {
    "a": 1,
    "b": 2
  },
  "frontend_ws_timeout_minutes": 20,
  "long_history_points": 120
}
```

| 字段                   | 类型           | 说明                                     |
| -------------------- | ------------ | -------------------------------------- |
| `version`            | string       | 当前部署自身 Workers 版本                         |
| `is_public`          | boolean      | 站点是否公开                                     |
| `authorization`     | boolean      | 当前请求是否携带有效 JWT                           |
| `turnstile_enabled`  | boolean      | 站点是否启用人机验证                             |
| `turnstile_login_enabled` | boolean | 登录是否需要 Turnstile；全局 Turnstile 开启时该值也为 `true` |
| `turnstile_site_key` | string       | Turnstile 前端公钥；前端拿到后渲染 widget          |
| `site_title`         | string       | 站点标题                                         |
| `display_mode`       | string       | 内置前端显示模式：`bar` / `ring` / `table`        |
| `verified`           | boolean      | 当前 Turnstile 验证状态；有效的验证凭证或本次成功验证的 Token 均可使其为 `true` |
| `turnstile_verified` | string\|null | 当次验证成功后回写给客户端的"已验证凭证"，客户端应回存并在 1 小时内复用 |
| `last_workers_version` | string\|null | **仅登录时出现**；远程最新 Workers 版本，来源为 GitHub `version.json`，后端缓存 5 分钟 |
| `last_agent_version` | string\|null | **仅登录时出现**；远程最新 Agent 版本，来源为 GitHub `version.json`，后端缓存 5 分钟 |
| `theme_options`      | object       | 第三方主题自定义配置；未配置时为空对象，匿名请求也会返回 |
| `frontend_ws_timeout_minutes` | number | 前端实时订阅连接超时分钟数，范围 `0`-`1440`；默认 `0` 表示不超时 |
| `long_history_points` | number      | 长历史查询返回的采样点数，后台可选 `60`、`120`、`180`、`240` |

> ~~`X-Turnstile-Token` 携带且验证成功时，响应头会同步设置 `X-Turnstile-Verified`。~~ **2026-07-26 修订**：当前前端从响应体的 `turnstile_verified` 保存凭证；响应 Header 尚未实际写入。

***

### 2.2 `GET /api/servers` - 获取服务器列表（首页）

**Request**

- Method：`GET`
- Path：`/api/servers`
- Headers（按需）：`Authorization: Bearer <jwt>`、`X-Turnstile-Token` 或 `X-Turnstile-Verified`

**Response** `200 OK`

```json
{
  "servers": [ /* Server[]，见 5.1 */ ],
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
    "show_three_net_details": true,
    "display_mode": "bar"
  }
}
```

| 字段            | 说明                                                                    |
| ------------- | --------------------------------------------------------------------- |
| `servers`     | 已合并最新指标的服务器列表（按 `sort_order ASC`），未登录用户**自动过滤** **`is_hidden = '1'`** |
| `latestReportUpdates` | 每台服务器最近一次批量上报的采样回放数据，用于新页面连续回放；来自 Worker/DO 内存状态，保留约 5 分钟，进程重启或 DO 回收后允许为空。REST 响应中的样本统一为 `{ ts, data }`，`data` 按探针批量采样包透传；内置探针默认只在普通采样点上报 `cpu`、`ram_total`、`ram_used`、`swap_total`、`swap_used`、`net_in_speed`、`net_out_speed` |
| `stats`       | 聚合统计：在线阈值 300 秒（5 分钟无上报视为离线）                                          |
| `regionStats` | 按 ISO 区域码（大写）统计的服务器数                                                  |
| `sysConfig`   | 当前站点开关：`show_price`、`show_expire`、`show_tf`、`show_three_net_details`、`display_mode`。主题配置请从 `/api/config` 的 `theme_options` 读取。~~旧版示例中的 `site_title` 不在该对象内。~~（2026-07-26 修订） |

> `/api/servers` 的 `latestReportUpdates` 每次请求都会读取 DO 实时状态，并与当前 Worker isolate 内约 5 分钟的最近上报回放合并。`servers[].ping` / `servers[].loss` 只在 `sysConfig.show_three_net_details === true` 时从 D1 最近 1 小时历史抽样返回，最多 30 个真实样本点，当前 Worker isolate 内缓存约 2 分钟；关闭三网详情时返回空数组且不触发这部分 D1 查询。抽样点保留真实上报时间，不做固定 2 分钟时间戳对齐，也不会用最近点补齐缺口。

***

### 2.3 `GET /api/server` - 获取单台服务器详情

**Request**

- Method：`GET`
- Path：`/api/server`
- Query：
  - `id`（**必填**）：服务器 UUID
- Headers（按需）：同 `/api/servers`

**Response** `200 OK`

```json
{
  "id": "9b2c...",
  "name": "HK-01",
  "server_group": "HK",
  "price": "30.00",
  "billing_cycle": "month",
  "auto_renewal": "0",
  "currency": "¥",
  "expire_date": "2026-12-31",
  "traffic_limit": "1TB",
  "traffic_calc_type": "total",
  "interface": "eth0,ens3",
  "reset_day": 1,
  "collect_interval": 1,
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
  "ping_ct": 23,
  "ping_cu": 25,
  "ping_cm": 30,
  "ping_bd": 40,
  "loss_ct": 0,
  "loss_cu": 0,
  "loss_cm": 0,
  "loss_bd": 0,
  "ram_total": 8192,
  "ram_used": 3700,
  "swap_total": 2048,
  "swap_used": 100,
  "disk_total": 102400,
  "disk_used": 32000,
  "disk": {
    "read_bps": 4096,
    "write_bps": 2048,
    "read_iops": 12,
    "write_iops": 8,
    "await_ms": 1.5,
    "util": 3.2
  },
  "cpu_cores": 4,
  "cpu_info": "Intel(R) Xeon(R) CPU",
  "gpu_info": "[{\"id\":\"0\",\"name\":\"NVIDIA GeForce RTX 3060\",\"info\":12.5}]",
  "arch": "x86_64",
  "os": "Ubuntu 22.04",
  "kernel_version": "6.8.0-36-generic",
  "region": "HK",
  "ip_v4": "1",
  "ip_v6": "1",
  "boot_time": "1700000000000",
  "last_updated": 1737638400000,
  "timestamp": 1737000000000,
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

> `last_updated` 来自最新指标；`timestamp` 是服务器配置记录的创建/导入时间字段，普通编辑不会刷新它。~~两者都表示最近上报时间。~~（2026-07-26 修订）
> `/api/server` 详情接口不返回新增的 `ping` / `loss` 窗口数组；详情页仍可使用 `ping_ct` / `ping_cu` / `ping_cm` / `ping_bd` 与 `loss_ct` / `loss_cu` / `loss_cm` / `loss_bd` 当前单点值。`latestReportUpdates` 与 `/api/servers` 同名字段形状一致，仅包含当前服务器最近一次批量上报的采样回放包；用于详情页打开时连续回放。REST 样本统一为 `{ ts, data }`，`data` 按探针采样包透传。回放状态保留约 5 分钟，Worker/DO 重启后允许为空数组。

**失败返回**：

- `400 { "error": "Missing ID", "code": 400 }` 缺少 `id`
- `404 { "error": "Server not found", "code": 404 }` 不存在 / 被隐藏（未登录访问时）

***

### 2.4 `GET /api/history/all` - 获取历史指标

**Request**

- Method：`GET`
- Path：`/api/history/all`
- Query：
  - `id`（**必填**）：服务器 UUID
  - `hours`（可选，默认 `24`）：只接受 `0.167`、`0.5`、`1`、`6`、`12`、`24`、`48`、`96`、`168`。~~任意不超过 168 的浮点数均可使用。~~（2026-07-26 修订）
- Headers（按需）：同 `/api/servers`

**Response** `200 OK`

~~旧版文档将响应描述为 `{columns, rows}` 包装对象。~~ **2026-07-26 修订**：当前直接返回 `HistoryRow[]`。

```json
[
  {
    "timestamp": 1737600000000,
    "cpu": 12.3,
    "gpu_info": "[{\"id\":\"0\",\"name\":\"NVIDIA GPU\",\"info\":12.5}]",
    "ram_total": 8192,
    "ram_used": 3700,
    "disk_total": 102400,
    "disk_used": 32000,
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
    "region": "HK"
  }
]
```

**采样间隔（自动）**

~~旧版按 `≤1 / 1~6 / 6~12 / 12~24 / 24~48 / 48~96 / 96~168` 小时使用固定步长，并把大于 168 的值截断。~~ **2026-07-26 修订**：当前不接受白名单之外的时长；长历史查询按后台 `long_history_points` 配置动态计算窗口，默认 120 个点：

```text
intervalMs = max(10_000, ceil(hours * 60 * 60 * 1000 / long_history_points))
```

> 历史查询使用 `ROW_NUMBER() OVER (PARTITION BY ts/interval ORDER BY ts)` 取每个采样窗口的第一条。

~~**跨月查询**：当查询早于当月 1 日时读取旧表。~~ **2026-07-26 修订**：历史表在每周日 00:00 UTC 轮换；当查询起点早于本周日且存在 `metrics_history_old` 时，自动 `UNION ALL` 当前表和旧表。

**缓存**：命中内存缓存时返回 `X-Cache: HIT`，反之 `MISS`。TTL 取决于 `hours`：

| hours | TTL   |
| ----- | ----- |
| ≥ 120 | 10 分钟 |
| ≥ 60  | 5 分钟  |
| ≥ 30  | 3 分钟  |
| < 30  | 1 分钟  |

**未登录限制**：`hours > 24` 时强制 `401`。

**数据库升级提示**：当 D1 缺少新字段时返回：

~~`{ "code": "DATABASE_UPGRADE_REQUIRED" }`~~

当前响应（2026-07-26）：

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{"message":"databaseUpgradeRequired"}
```

此时应先调用 [`POST /updateDatabase`](#41-post-updatedatabase---数据库迁移)。

***

### 2.5 `GET /api/ws` - WebSocket 实时推送

**Request**

- Method：`GET`（**必须**带 `Upgrade: websocket` Header）
- Path：`/api/ws`
- Query：
  - `subscribe`（可选，默认 `all`）：
    - `all` → 订阅所有服务器的最新指标（**批量合并推送，每 5 秒一次**）
    - `<serverId>` → 只订阅指定服务器；~~收到上报后立即实时推送。~~ **2026-07-26 修订**：同样经过最长约 5 秒的 Worker 合并窗口
  - `token` / `auth_token` / `ws_token`（私有站点可选）：JWT 登录令牌，用于浏览器 WebSocket 无法设置 `Authorization` Header 的场景

**鉴权**：

- 公开站点：无需 JWT。
- 私有站点：必须通过 WebSocket JWT 认证，认证来源支持 `Authorization: Bearer <jwt>`、`Cookie: cfsm_auth=<jwt>`、查询参数 `token` / `auth_token` / `ws_token`。浏览器前端同域走 Cookie，跨域走查询参数。
- `ids` 只控制订阅过滤范围，不是服务端鉴权。

**Response** `101 Switching Protocols`（WebSocket 握手）

**握手 Header 要求**：

```
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: <base64>
Sec-WebSocket-Version: 13
```

**推送策略**：

| 订阅类型 | 推送方式 | 消息类型 | 说明 |
| -------- | ----- | ----- | --- |
| `subscribe=all` | 批量合并，每 5 秒一次 | `batchUpdate` | 减少消息数量，降低前端渲染压力 |
| `subscribe=<serverId>` | 最长约 5 秒批量窗口 | `batchUpdate` | 单台服务器详情页仅过滤目标 ID，消息仍经统一合并队列 |

> `subscribe=all` 默认不推送任何服务器更新。客户端应先调用 `/api/servers` 获取当前可见服务器列表，再通过 WebSocket 通道发送 `subscribe` 消息，使用 `servers[].id` 作为过滤列表。

**服务端 → 客户端消息**：

1. 连接成功（Hello）
   ```json
   { "type": "hello", "ts": 1737638400000, "subscribed": "all" }
   ```
2. 指标更新（统一使用 `batchUpdate`，`subscribe=all` 和 `subscribe=<serverId>` 均支持）
   ```json
   {
     "type": "batchUpdate",
     "ts": 1737638400000,
     "updates": [
       {
         "serverId": "9b2c...",
         "samples": [
           {
             "ts": 1737638398000,
             "data": { /* Server 增量字段 */ }
           },
           {
             "ts": 1737638399000,
             "data": { /* Server 增量字段；批次最后一条包含本次完整报告状态 */ }
           }
         ]
       },
       {
         "serverId": "a1f3...",
         "samples": [
           {
             "ts": 1737638398500,
             "data": { /* Server 增量字段；批次最后一条包含本次完整报告状态 */ }
           }
         ]
       }
     ]
   }
   ```

   批量样本中的高频采样点主要包含 `cpu`、内存、Swap、网速和时间字段；每次上报的最后一个样本会额外携带报告级字段，用于同步磁盘、GPU、进程、连接数、探针、Ping/丢包等无需按采样率刷新的数据。

**客户端 → 服务端消息**（可选）：

```json
{ "type": "subscribe", "scope": "all", "ids": ["server-001", "server-002"] }
{ "type": "ping" }   // → 服务端自动回精确字符串 {"type":"pong"}，不含 ts
{ "type": "pong" }   // 静默忽略
```

`subscribe` 消息用于更新当前 WebSocket 的订阅范围：

- `scope`：可选，默认沿用 URL 中的 `subscribe`，通常为 `all`
- `ids`：可选数组，来自 `/api/servers` 返回的 `servers[].id`；`subscribe=all` 时仅推送这些 ID 的更新。最多 500 个，每个 ID 长度 1-64，仅允许字母、数字、`.`、`_`、`:`、`-`

若 `scope` 或 `ids` 格式非法，服务端会关闭 WebSocket 连接（close code `1008`）。

服务端确认消息：

```json
{ "type": "subscribed", "ts": 1737638400000, "subscribed": "all", "count": 2 }
```

**失败返回**：

- `503 { "error": "WebSocket not enabled", "code": 503 }` —— 未绑定 `METRICS_BROADCASTER` Durable Object
- `426 Expected WebSocket upgrade request` —— 缺少 `Upgrade: websocket` 头
- `401 { "error": "Unauthorized", "code": 401 }` —— 私有站点缺少有效 WebSocket JWT
- `400 Invalid subscription scope` —— URL 中的 `subscribe` 不合法
- `403 Forbidden` ——设置了 WebSocket `Origin`，且不在 `CORS_ALLOWED_ORIGINS` 中
- `500 { "error": "WebSocket error", "code": 500 }` —— Worker 转发至 DO 失败

**前端使用示例（subscribe=all，批量推送）**：

```js
const { servers } = await (await fetch('/api/servers')).json();
const ids = servers.map(s => s.id);
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
      // 更新对应 serverId 的卡片
      for (const s of u.samples || []) {
        updateServer(u.serverId, s.data);
      }
    }
  }
};
```

**前端使用示例（subscribe=serverId，单服务器推送）**：

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

### 2.6 `GET /theme` - 获取主题商店数据

> **鉴权 / Turnstile**：均不参与。

从以下上游读取并规范化主题商店清单，Worker 内存缓存 300 秒：

```text
https://raw.githubusercontent.com/huilang-me/CFSM-Theme-Store/refs/heads/main/themes.json
```

**Response 200**

```json
{
  "schema": 1,
  "themes": [
    {
      "name": "Example Theme",
      "url": "https://github.com/Tokinx/cf-server-monitor-theme-emerald",
      "branch": "build"
    }
  ]
}
```

- 上游对象的其他字段原样保留。
- 后端只读取上游 `themes.json`，不调用 GitHub commits API 生成 `versions`。
- 管理端主题商店默认不请求版本列表；点击主题卡片的“加载版本”后，才会在浏览器端通过 `api.github.com` 读取该主题仓库最近 10 个 commit，并生成可直接写入 `theme_url` 的版本下拉。
- `schema` 缺失时补为 `1`；`themes` 不是数组时补为空数组；上游 `themes.json` 不需要提供 `versions`。
- 上游读取失败且没有命中 300 秒内存缓存时返回 `502`，管理端会改由浏览器端访问 `raw.githubusercontent.com` 作为 fallback。

***

### 2.7 前端与主题代理

这些路径返回 HTML 或静态文件，不使用统一 JSON 响应格式。

| Path | 行为 |
| ---- | ---- |
| `/`、`/#/`、`/#/server/:id` 等前台路径 | `theme_url` 为空时返回内置主题；配置第三方主题时返回反代后的主题 `index.html` |
| `/admin` | 始终返回内置默认主题的管理后台入口 |
| `/admin/` | `302` 跳转到 `/admin#admin` |
| `/assets/*` | 配置或预览第三方主题时反代对应主题 `assets/`；未配置主题时返回 404 |
| 其他静态路径 | 不走主题反代，由 Workers Static Assets 直接处理，缓存头以 `public/_headers` 为准 |

**主题 URL 规则**：

```text
https://github.com/<owner>/<theme-repo>/tree/<commit-or-branch>[/theme-subdir]
```

主题商店会保存由独立 GitHub 主题仓库 commit 生成的 tree 地址。建议使用 commit id 固定版本。

**反代规则**：

- 只代理主题目录下的 `index.html` 和 `assets/*`
- GitHub raw 默认 `text/plain` 会被 Worker 按文件后缀修正为 CSS、JS、图片、字体等对应 `Content-Type`
- 远程主题 `index.html` 和 `assets/*` 使用 `caches.default` 缓存：commit id 固定版 1 天，分支名版本 1 小时，缓存 key 包含 Git ref、作者、主题目录和资源路径
- 主题商店列表 `/theme` 使用 Worker 内存缓存 5 分钟
- 最终 HTML 会注入站点标题、背景图、自定义 `<head>`、自定义脚本，并移除主题自带 CSP meta
- CSP 通过 HTTP Response Header 返回，同时设置 `X-Frame-Options: DENY`
- 主题 `index.html` 不可用时返回 `502 Theme index.html is unavailable`，不会自动回落到内置主题
- 主题资源不可用时返回对应错误状态，不会回落成内置静态文件

**预览鉴权**：

`/?theme_url=...` 只在已登录管理员通过 `start_theme_preview` 获取临时授权后生效。授权 cookie 有效期 10 分钟；未授权直接访问会返回 `401 Theme preview requires admin login`。

***

## 3. 管理端 API（鉴权）

### 3.1 `POST /admin/api` - 管理操作入口

> 所有管理操作都通过这一个端点 + `action` 字段路由。

**Request**

- Method：`POST`
- Path：`/admin/api`
- Headers（除 `login` 外必填）：
  ```
  Content-Type: application/json
  Authorization: Bearer <jwt>
  ```
- Body（JSON）：
  ```json
  { "action": "<one of: login|clear_theme_preview_auth|get_settings|start_theme_preview|list|d1_usage|send_test_notification|save_settings|add|delete|save_order|edit|batch_delete|export_servers|import_servers>", ...payload }
  ```

**Turnstile**：

- 仅 `action: login` 启用 Turnstile 验证（请求头 `X-Turnstile-Token`）；当 `turnstile_enabled` **或** `turnstile_login_enabled` 为 `true` 时要求 token
- 其他 action：**不**走 Turnstile 流程（白名单 bypass）

**Response**：~~所有响应统一为 `200 OK`。~~ **2026-07-26 修订**：成功响应通常为 `200`；参数、鉴权、Turnstile 或未捕获异常分别使用实际的 `4xx/5xx` 状态码。具体结构见下文各小节。

***

### 3.2 `action: login` - 登录

**Request**

```json
{
  "action": "login",
  "username": "admin",
  "password": "<plain text>"
}
```

Header：`X-Turnstile-Token: <token>`（当 `site_options.turnstile_enabled` 或 `turnstile_login_enabled` 为 `true` 时**必填**）

**Response 200**

```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsImlhdCI6MTczNzYzODQwMCwiZXhwIjoxNzM4MjQzMjAwfQ.signature",
  "message": "loginSuccessful"
}
```

**Response 失败**

- ~~`400 { "error": "Missing username or password" }`~~ → `400 { "error": "missingCredentials", "code": 400 }`
- ~~`401 { "error": "Invalid username or password" }`~~ → `401 { "error": "invalidCredentials", "code": 401 }`
- ~~`403 { "error": "Turnstile verification failed" }`~~ → `403 { "error": "verificationFailed", "code": 403 }`

> 错误字符串是供前端 i18n 使用的 message key，并非稳定的人类可读英文。（2026-07-26 修订）

***

### 3.3 `action: get_settings` - 读取全部设置

**Request**

```json
{ "action": "get_settings" }
```

**Response 200**

```json
{
  "success": true,
  "settings": { /* Settings 对象，见 5.4 */ },
  "api_secret": "<env.API_SECRET>"
}
```

> `api_secret` 仅在 `get_settings` 中返回，方便前端展示/复制。
>
> ~~`settings` 包含 `jwt_secret`。~~ **2026-07-26 修订**：后端会从返回对象中剔除 `jwt_secret`；其他敏感值（如密码哈希、Cloudflare Token、Turnstile Secret）仍可能存在，必须使用 HTTPS 并限制管理 Token。

***

### 3.4 `action: list` - 列出全部服务器（含在线/统计）

**Request**

```json
{ "action": "list" }
```

**Response 200**

```json
{
  "success": true,
  "servers": [ /* Server[]，包含 is_hidden、is_online 等所有字段 */ ],
  "stats": {
    "total": 10,
    "online": 8,
    "offline": 2,
    "total_cpu": 96.3,
    "total_net_in": 12345.6,
    "total_net_out": 7890.1,
    "avg_cpu": "12.04"
  }
}
```

| 字段             | 说明                      |
| -------------- | ----------------------- |
| `is_online`    | `true` = 最近 5 分钟内有上报    |
| `last_updated` | 最近一次上报时间戳（毫秒）           |
| `stats.avg_cpu` | 仅按在线服务器平均，保留 2 位小数（在线服务器存在时为字符串；初始值为 number `0`） |

> 注意：本接口**包含** `is_hidden=1` 的服务器（与 `/api/servers` 不同）。
>
> ~~旧版示例中的 `total_ram`、`total_disk`、`avg_ram`、`avg_disk` 会返回。~~ **2026-07-26 修订**：当前实现不计算这些字段。

***

### 3.5 `action: d1_usage` - D1 / Workers / Durable Objects 用量

**Request**

```json
{
  "action": "d1_usage",
  "cloudflare_token": "<optional override>",
  "cloudflare_account_id": "<optional override>"
}
```

**前置条件**：Cloudflare Token 与 Account ID 必须通过请求体提供，或已保存在 `site_options`。请求体字段存在时优先使用，即使值为空字符串也会覆盖保存值。

**Response 200**

```json
{
  "success": true,
  "usage": {
    "today": {
      "rowsRead": 12345,
      "rowsWritten": 678,
      "workersRequests": 1234,
      "durableObjectsRequests": 1420,
      "durableObjectsHttpRequests": 1000,
      "durableObjectsHibernationWakeups": 400,
      "durableObjectsInboundWebSocketMessages": 400,
      "durableObjectsOutboundWebSocketMessages": 6900,
      "durableObjectsRawRequests": 1400,
      "durableObjectsRequestsEstimated": true,
      "durableObjectsRequestBillingRatio": 20,
      "durableObjectsDuration": 12.34
    },
    "yesterday": {
      "rowsRead": 23456,
      "rowsWritten": 789,
      "workersRequests": 2345,
      "durableObjectsRequests": 2630,
      "durableObjectsHttpRequests": 2000,
      "durableObjectsHibernationWakeups": 600,
      "durableObjectsInboundWebSocketMessages": 600,
      "durableObjectsOutboundWebSocketMessages": 9120,
      "durableObjectsRawRequests": 2600,
      "durableObjectsRequestsEstimated": true,
      "durableObjectsRequestBillingRatio": 20,
      "durableObjectsDuration": 23.45
    }
  },
  "message": "d1UsageQueried"
}
```

> ~~响应会返回日期、套餐限额、剩余额度、数据库数量和 Account ID。~~ **2026-07-26 修订**：当前返回两个时间范围的 `rowsRead`、`rowsWritten`、`workersRequests`、`durableObjectsRequests`、`durableObjectsDuration`；额度由前端自行展示，不属于 API 响应。`durableObjectsDuration` 单位为 GB-s。**2026-08-15 修订**：`durableObjectsRequests` 为计费请求数估算值：`durableObjectsHttpRequests` 与 `durableObjectsHibernationWakeups` 按 `1:1` 计入，`durableObjectsInboundWebSocketMessages` 按 `20:1` 折算计入，`durableObjectsOutboundWebSocketMessages` 仅返回数量但不计入请求计费。`durableObjectsRawRequests` 为 `durableObjectsInvocationsAdaptiveGroups` 返回的原始 Durable Objects invocation request 总数，包含 HTTP/升级请求与 Hibernation 唤醒。
>
> **统计窗口**：`today` 为 UTC 当日 `00:00:00` 至 `23:59:59`；`yesterday` 为 UTC 昨日 `00:00:00` 至 `23:59:59`。

**Response 失败**

- `400 { "error": "cloudflareTokenRequired", "code": 400 }`
- `400 { "error": "cloudflareAccountIdRequired", "code": 400 }`
- `400 { "error": "<Cloudflare GraphQL 错误信息>", "code": 400 }`

> 通过 Cloudflare GraphQL API（`https://api.cloudflare.com/client/v4/graphql`）查询：
>
> - `d1AnalyticsAdaptiveGroups`（`rowsRead` / `rowsWritten`）
> - `workersInvocationsAdaptive`（`requests`）
> - `durableObjectsInvocationsAdaptiveGroups`（`requests`，作为 `durableObjectsRawRequests`）
> - `durableObjectsPeriodicGroups`（`duration`，单位 GB-s）

***

### 3.6 `action: save_settings` - 保存设置

**Request**

```json
{
  "action": "save_settings",
  "settings": {
    "site_title": "My Server Monitor",
    "custom_bg": "https://...",
    "custom_head": "<style>...</style>",
    "custom_script": "console.log('hi');",
    "csp_static": "https://static.example.com",
    "csp_api": "https://api.example.com",
    "display_mode": "bar",
    "theme_url": "https://github.com/Tokinx/cf-server-monitor-theme-emerald/tree/8cea2bbdbadb50684f2e97e13f7b2149ef99911b",
    "appearance_options": {
      "theme_options": {
        "a": 1,
        "b": 2
      }
    },
    "is_public": "true",
    "show_price": "true",
    "show_expire": "true",
    "show_tf": "true",
    "frontend_ws_timeout_minutes": "20",
    "long_history_points": "120",
    "tg_notify": "0",
    "tg_bot_token": "",
    "tg_chat_id": "",
    "notification_timezone": "UTC",
    "expire_notification_time": "12",
    "turnstile_enabled": "false",
    "turnstile_login_enabled": "false",
    "turnstile_site_key": "",
    "turnstile_secret_key": "",
    "jwt_secret": "",
    "username": "admin",
    "password": "<plain text, will be PBKDF2-hashed before save>",
    "cloudflare_account_id": "",
    "cloudflare_token": "",
    "custom_ct": "gd-ct-dualstack.ip.zstaticcdn.com",
    "custom_cu": "gd-cu-dualstack.ip.zstaticcdn.com",
    "custom_cm": "gd-cm-dualstack.ip.zstaticcdn.com",
    "custom_bd": "ip.zstaticcdn.com",
    "expire_reminder": "0"
  }
}
```

**字段分类**：

- `APPEARANCE_FIELDS`（写入 `appearance_options` JSON）：`site_title`、`custom_bg`、`custom_head`、`custom_script`、`csp_static`、`csp_api`、`display_mode`、`theme_options`
- `SITE_FIELDS`（写入 `site_options` JSON）：`is_public`、`show_price`、`show_expire`、`show_tf`、`wss_report_enabled`、`wss_report_hours`、`frontend_ws_timeout_minutes`、`long_history_points`、通知、Turnstile、账号、Cloudflare、Ping 节点、`expire_reminder`、`notification_timezone`、`expire_notification_time`、`theme_url`、历史优化字段等站点级配置。`wss_report_hours` 是允许 Agent WSS 上报的 UTC 小时数组（`0-23`）；缺失时默认全天，空数组表示所有时段均关闭
- 任何未列出的字段会被忽略

**特殊处理**：

- `password`：以**明文**传入；后端用 PBKDF2-HMAC-SHA-256（50,000 iterations、16 字节 salt、32 字节 hash）计算后保存为 `pbkdf2_sha256$50000$<salt hex>$<hash hex>`；如传空字符串则**不更新**密码；旧版 32 位 MD5 哈希仍可登录并会在成功登录后自动升级
- `theme_url`：可单独通过 `{"settings":{"theme_url":"..."}}` 保存；允许 `https://github.com/<owner>/<repo>/tree/<commit-or-branch>[/theme-subdir]` 格式。保存前会请求对应 raw `index.html` 验证可用性，失败返回 `400 invalidThemeUrl`，不会保存
- Ping 节点字段：仅校验本次请求中出现的 `custom_ct/custom_cu/custom_cm/custom_bd` 字段，因此只保存 `theme_url` 不会触发 Ping 节点格式校验
- Turnstile：本次请求把 `turnstile_enabled` 或 `turnstile_login_enabled` 设为 `true` 时，必须同时提供非空 `turnstile_site_key` 与 `turnstile_secret_key`
- 通知：规范化后的 `tg_notify` 非 `0`，或 `expire_reminder` 为 `1`-`7` 时，必须提供非空 `tg_bot_token`
- `notification_timezone`：通知输出时间和到期提醒计划使用的 IANA 时区；缺失或非法值回退为 `UTC`
- `expire_notification_time`：到期提醒每天在通知时区内执行的小时，取值 `0`-`23`；缺失或非法值回退为 `12`
- `appearance_options` / `theme_options`：必须是非数组对象；`display_mode` 规范为 `bar` / `ring` / `table`
- `frontend_ws_timeout_minutes`：规范为 `0`-`1440` 的整数分钟；缺失或非法值回退为 `0`，即前端连接不超时
- `csp_static` / `csp_api`：逗号分隔，只保留不带凭据、路径、查询或 fragment 的 HTTPS origin，非法项会被静默过滤
- 外观设置不是字段级合并：请求中只要出现任一外观字段或 `appearance_options`，后端就会用本次提供的外观字段重写整个 `appearance_options` JSON；部分更新时应先读取并回传完整外观对象
- `jwt_secret` 不在保存阶段校验长度；只有长度至少 32 的值会用于签名，空值或短值在下一次加载设置时会被新生成并持久化的随机密钥替换

**Response 200**

```json
{ "success": true, "message": "updateSuccess" }
```

> 副作用：清空 `site_options` 内存缓存，下一次请求会从 DB 重新加载。

***

### 3.6.1 `action: start_theme_preview` - 生成主题预览授权

**Request**

```json
{
  "action": "start_theme_preview",
  "theme_url": "https://github.com/Tokinx/cf-server-monitor-theme-emerald/tree/8cea2bbdbadb50684f2e97e13f7b2149ef99911b"
}
```

**行为**：

- 需要携带有效 `Authorization: Bearer <jwt>`
- 校验 `theme_url` 格式，并请求对应 raw `index.html` 确认可访问
- 成功后设置 HttpOnly Cookie：`cfsm_theme_preview_auth`，有效期 600 秒
- 返回可直接打开的预览地址：`/?theme_url=<encoded theme_url>`

**Response 200**

```json
{
  "success": true,
  "preview_url": "https://status.example.com/?theme_url=https%3A%2F%2Fgithub.com%2FTokinx%2Fcf-server-monitor-theme-emerald%2Ftree%2F8cea2bbdbadb50684f2e97e13f7b2149ef99911b"
}
```

失败时返回 `400 invalidThemeUrl` 或 `401 Unauthorized`。

***

### 3.6.2 `action: clear_theme_preview_auth` - 清除主题预览授权

**Request**

```json
{ "action": "clear_theme_preview_auth" }
```

**行为**：清除 `cfsm_theme_preview_auth` Cookie。该 action 可在未登录时调用，用于离开管理页后清理临时预览授权。

**Response 200**

```json
{ "success": true }
```

***

### 3.7 `action: add` - 新增服务器

**Request**

```json
{ "action": "add", "name": "New Server", "server_group": "Default" }
```

**Response 200**

```json
{
  "success": true,
  "id": "<newly generated UUID v4>",
  "message": "serverAdded"
}
```

**约束**：

- `name`：1 \~ 100 字符，否则 `400 { "error": "服务器名称无效", "code": 400 }`
- `server_group`：默认 `Default`
- `sort_order`：自动 = `MAX(sort_order) + 1`

***

### 3.8 `action: edit` - 修改服务器信息

**Request**

```jsonc
{
  "action": "edit",
  "id": "<server UUID>",
  "name": "HK-01",
  "server_group": "HK",               // 默认 "Default"
  "tags": "production,hk",
  "note": "Primary node",
  "price": "30.00",                   // 字符串，保存时自动转换为两位小数；"0" 或 "-1" 表示免费，空白表示未设置
  "billing_cycle": "month",            // month | quarter | half_year | year | two_years | three_years | four_years | five_years
  "auto_renewal": "0",                 // "0" | "1"
  "currency": "¥",                     // ¥ | $ | € | £ | ₽ | ₣ | ₹ | ₫ | ฿
  "expire_date": "2026-12-31",
  "traffic_limit": "1TB",
  "traffic_calc_type": "total",       // total | ...
  "interface": "eth0,ens3",           // 指定统计网卡，多个用英文逗号分隔；空值自动汇总
  "reset_day": 1,                     // 必传整数：0 ~ 31
  "collect_interval": 1,              // 必传：0 | 1 | 2 | 5 | 10
  "report_interval": 60,              // 必传：30 | 60 | 120 | 180
  "auto_update": "0",                // boolean-like，规范为 "0" | "1"
  "custom_ct": "gd-ct-dualstack.ip.zstaticcdn.com",
  "custom_cu": "gd-cu-dualstack.ip.zstaticcdn.com",
  "custom_cm": "gd-cm-dualstack.ip.zstaticcdn.com",
  "custom_bd": "ip.zstaticcdn.com",
  "rx_correction": null,              // null/空或 0 ~ 1000000
  "tx_correction": null,
  "offline_notify_disabled": "0",
  "is_hidden": "0"
}
```

**校验与覆盖规则（2026-07-26）**：

- ~~`reset_day` 只允许 `1~31`，三个探针配置字段均可省略。~~ 当前 `reset_day` 允许 `0~31`，且 `reset_day`、`collect_interval`、`report_interval` 都必须作为 JSON number 传入；组合最多生成 300 个样本/次上报。
- 当前实现按整行覆盖：省略 `name` 会保存为空字符串，省略 `server_group` 会保存 `Default`，其他多个字段也会回落为空值或默认值。调用方应先读取 `list` 后提交完整编辑对象。
- `tags` 最多保留 12 个，每个最多 32 字符并过滤特殊字符；`note` 去除首尾空白后最多 500 字符。
- 自定义 Ping 节点接受 `host` 或 `host:port`；流量修正接受 `null`/空值或 `0~1000000` 数字。
- 当前实现不检查 `UPDATE` 的影响行数；格式合法但不存在的 UUID 也可能返回成功。

**Response 200**

```json
{ "success": true, "message": "serverUpdated" }
```

**Response 失败**

- `400 { "error": "invalidServerId", "code": 400 }` —— UUID 格式错
- `400` + `collect_interval/report_interval/reset_day` 校验消息 —— 探针配置不合法
- `400 { "error": "invalidPingNodeFormat", "code": 400 }`
- `400 { "error": "invalidTrafficCorrection", "code": 400 }`
- ~~DB 缺字段时返回 `500 Update failed...`。~~ **2026-07-26 修订**：后端会先尝试补列，再返回 `400 { "error": "dbColumnsAdded", "code": 400 }`，客户端应重新提交编辑请求

***

### 3.9 `action: delete` - 删除服务器

**Request**

```json
{ "action": "delete", "id": "<server UUID>" }
```

**副作用**：~~级联删除该 server 的全部 `metrics_history` 记录。~~ **2026-07-26 修订**：后端仅在 `PRAGMA foreign_key_list(metrics_history)` / `metrics_history_old` 返回外键时，才会显式删除对应历史行；当前标准建表结构没有定义该外键，因此通常只删除 `servers` 记录，历史行会保留到表轮换或清空历史。合法但不存在的 UUID 也可能返回成功。

**Response 200**

```json
{ "success": true, "message": "serverDeleted" }
```

UUID 缺失或格式非法时返回 `400 { "error": "invalidServerId", "code": 400 }`。

***

### 3.10 `action: batch_delete` - 批量删除

**Request**

```json
{ "action": "batch_delete", "ids": ["<uuid1>", "<uuid2>", "<uuid3>"] }
```

**Response 200**

```json
{ "success": true, "message": "batchDeleted" }
```

批量删除沿用单条删除的历史数据处理规则；`ids` 不是非空数组时返回 `400 selectServersToDelete`，任一 UUID 格式非法时整批返回 `400 invalidServerIdInList`，合法但不存在的 UUID 不会单独报错。

***

### 3.11 `action: save_order` - 保存服务器排序

**Request**

```json
{ "action": "save_order", "orders": ["<uuid1>", "<uuid2>", "<uuid3>"] }
```

**说明**：

- `orders[i]` 表示该 UUID 排序后应为第 `i` 位（`sort_order = i`）
- 服务端会逐条 `UPDATE sort_order = ? WHERE id = ?`
- `orders` 不是非空数组时返回 `400 missingSortData`；任一 UUID 格式非法时返回 `400 invalidSortId`
- 合法但不存在的 UUID 不会单独报错，仍可能返回成功

**Response 200**

```json
{ "success": true, "message": "sortOrderSaved" }
```

***

### 3.12 `action: send_test_notification` - 发送测试通知

使用请求体内的 Telegram Bot 配置发送一条测试消息，不会自动读取或保存站点设置。

**Request**

```json
{
  "action": "send_test_notification",
  "tg_bot_token": "<Telegram Bot Token>",
  "tg_chat_id": "<Chat ID>"
}
```

**Response 200**

```json
{ "success": true, "message": "testNotificationSent" }
```

**失败返回**：`400 tgBotTokenRequired` 或 `400 testNotificationFailed`。

***

### 3.13 `action: export_servers` - 导出服务器

导出 `servers` 表全部配置，按 `sort_order` 升序排列；不包含历史指标。

**Request**

```json
{ "action": "export_servers" }
```

**Response 200**

```json
{
  "success": true,
  "servers": [
    { "id": "9b2c4d3e-1a2b-4c5d-9e8f-7a6b5c4d3e2f", "name": "HK-01", "sort_order": 0 }
  ],
  "message": "serversExported"
}
```

**失败返回**：`400 serversExportFailed`。

***

### 3.14 `action: import_servers` - 导入服务器

**Request**

```json
{
  "action": "import_servers",
  "servers": [
    { "id": "9b2c4d3e-1a2b-4c5d-9e8f-7a6b5c4d3e2f", "name": "HK-01", "server_group": "HK" }
  ]
}
```

**行为说明**：

- `servers` 不是非空数组时返回 `400 noServersToImport`
- UUID 非法或与现有服务器重复的记录会被跳过
- `history_partition_id` 非法、重复或超出允许范围时会重新分配；无可用分区时跳过该记录
- 仅导入服务器配置，不导入 `metrics_history`；单行插入失败也会跳过，并继续处理后续记录

**Response 200**

```json
{
  "success": true,
  "imported": 2,
  "skipped": 1,
  "skippedIds": ["<duplicate-or-invalid-id>"],
  "message": "serversImported"
}
```

全部记录均跳过时仍返回 `200`，`message` 为 `noServersImported`。

***

## 4. 系统维护端点

> 以下端点需 JWT 鉴权（`Authorization: Bearer <token>`），不参与 Turnstile。

### 4.1 `POST /updateDatabase` - 数据库迁移

> 用于老版本升级时补齐 `metrics_history` 与 `servers` 表的字段、并清理废弃 settings。

**Request**

- Method：`POST`
- Path：`/updateDatabase`
- Headers：`Authorization: Bearer <jwt>`

**Response 200**

```json
{
  "success": true,
  "message": "databaseUpgradeSuccess",
  "results": [
    { "name": "metrics_history 索引检查", "success": true, "created": false, "message": "..." },
    { "name": "servers 表列更新", "success": true, "added": 5 },
    { "name": "servers 表多余字段清理", "success": true, "cleaned": 30, "message": "..." },
    { "name": "metrics_history 表列更新", "success": true, "added": 14 },
    { "name": "废弃 settings key 清理", "success": true, "cleaned": 0 },
    { "name": "删除弃用的 metrics_aggregated 表", "success": true, "dropped": 0, "message": "..." }
  ]
}
```

~~升级步骤包括 `metrics_history load -> load_avg` 迁移和 `metrics_history` 写入优化。~~ **2026-07-26 修订**：当前顺序为历史表索引检查、补齐 `servers` 列、清理 `servers` 多余列、补齐 `metrics_history` 列、清理废弃设置、删除弃用的 `metrics_aggregated` 表。

~~任一步骤抛错时返回 HTTP 500。~~ **2026-07-26 修订**：升级函数会捕获未被子步骤处理的错误并返回 `{ "success": false, "message": "databaseUpgradeFailed", "error": "...", "results": [...] }`；路由仍使用成功响应包装，因此通常为 HTTP `200`。各子步骤本身也会捕获错误，所以顶层 `success: true` 时 `results[]` 仍可能含 `success: false`，调用方必须同时检查两层状态。

***

### 4.2 `POST /clearHistory` - 清空历史数据

> **危险操作**：会删除 `metrics_history` / `metrics_history_old` 全部数据后重建。

**Request**

- Method：`POST`
- Path：`/clearHistory`
- Headers：`Authorization: Bearer <jwt>`

**Response 200**

```json
{ "success": true, "message": "databaseRebuiltSuccess" }
```

失败时返回 `{ "success": false, "message": "databaseRebuiltFailed", "error": "..." }`；与数据库升级相同，路由通常仍返回 HTTP `200`，必须检查业务 `success`。

***

### 4.3 `GET /__do/health` - Durable Object 健康检查

**Request**

- Method：`GET`
- Path：`/__do/health`
- Headers：无需鉴权

**Response 200**

```json
{ "ok": true, "subscribers": 3, "sockets": 4 }
```

`subscribers` 为前端实时订阅 WebSocket 数；`sockets` 为 DO 当前托管的全部 WebSocket 数，包含 Agent 上报 WSS 连接。

或

```json
{ "ok": false, "reason": "DO not bound" }
{ "ok": false, "reason": "<error message>" }
```

***

## 5. 数据结构

### 5.1 Server 对象

| 字段                                            | 类型                 | 说明                        |
| --------------------------------------------- | ------------------ | ------------------------- |
| `id`                                          | string (UUID)      | 主键                        |
| `name`                                        | string             | 显示名                       |
| `server_group`                                | string             | 分组                        |
| `tags`                                        | string             | 逗号分隔标签；编辑时最多保留 12 个，每个最长 32 字符 |
| `note`                                        | string             | 管理备注；仅管理端 `list` / 导出返回，公共接口会删除 |
| `price`                                       | string             | 价格金额文本，保存时规范为两位小数；`0` 或 `-1` 表示免费，空白表示未设置 |
| `billing_cycle`                               | string             | `month` / `quarter` / `half_year` / `year` / `two_years` / `three_years` / `four_years` / `five_years` |
| `auto_renewal`                                | string `"0"`/`"1"` | 是否启用自动续费                    |
| `currency`                                    | string             | 货币符号：`¥` 人民币、`$` 美元、`€` 欧元、`£` 英镑、`₽` 卢布、`₣` 法郎、`₹` 卢比、`₫` 越南盾、`฿` 泰铢 |
| `expire_date`                                 | string             | 到期日 `YYYY-MM-DD`          |
| `traffic_limit`                               | string             | 流量上限文本                    |
| `traffic_calc_type`                           | string             | `total` / 其他              |
| `interface`                                   | string             | 指定网卡统计，多个用英文逗号分隔；空值保持自动汇总 |
| `reset_day`                                   | number             | 流量重置日 `0..31`；`0` 表示不重置 |
| `collect_interval`                            | number             | 采集间隔枚举：`0` / `1` / `2` / `5` / `10` 秒 |
| `report_interval`                             | number             | 上报间隔枚举：`30` / `60` / `120` / `180` 秒 |
| `auto_update`                                 | string `"0"`/`"1"` | 探针自动更新；仅管理端 `list` / 导出返回，公共接口会删除 |
| `custom_ct` / `custom_cu` / `custom_cm` / `custom_bd` | string | 服务器级测速节点 `host[:port]`；为空时使用站点设置 |
| `rx_correction` / `tx_correction`             | number\|null       | 待下发给探针的一次性流量修正值 |
| `offline_notify_disabled`                     | string `"0"`/`"1"` | 是否禁用该服务器的离线通知 |
| `is_hidden`                                   | string `"0"`/`"1"` | 是否在前台隐藏                   |
| `sort_order`                                  | number             | 排序值（越小越靠前）                |
| `history_partition_id`                        | number             | 历史记录 ID 分区编号，由服务端分配 |
| `timestamp`                                   | number             | `servers` 配置记录的创建/导入时间戳（毫秒），不是最新指标时间 |
| `cpu`                                         | number             | 最新 CPU%（来自最新指标）           |
| `load_avg`                                    | string             | `"x x x"`                 |
| `net_in_speed`                                | number             | B/s                       |
| `net_out_speed`                               | number             | B/s                       |
| `net_rx`                                      | number             | 累计下行字节                    |
| `net_tx`                                      | number             | 累计上行字节                    |
| `net_rx_monthly`                              | number             | 当月累计下行字节                  |
| `net_tx_monthly`                              | number             | 当月累计上行字节                  |
| `processes`                                   | number             | 进程数                       |
| `tcp_conn`                                    | number             | TCP 连接数                   |
| `udp_conn`                                    | number             | UDP 套接字数                  |
| `ping_ct` / `ping_cu` / `ping_cm` / `ping_bd` | number\|null\|false | 各运营商延时 (ms)；`false` 表示禁用该节点 |
| `loss_ct` / `loss_cu` / `loss_cm` / `loss_bd` | number\|null\|false | 各运营商丢包率 (%)；`false` 表示禁用该节点 |
| `ping` / `loss`                               | array              | 仅 `/api/servers` 的 `servers[]` 列表项返回，`/api/server` 详情接口不返回；后台开启三网详情时，从 D1 最近 1 小时历史按时间范围抽样最多 30 个真实样本点，当前 Worker isolate 内缓存约 2 分钟；关闭三网详情时为空数组且不触发这部分 D1 查询。点格式为 `{ ts, ct, cu, cm, bd }`，`ct/cu/cm/bd` 分别对应电信、联通、移动、BGP。`ts` 为真实上报时间，不强制 2 分钟等差对齐，也不会用最近点补齐缺口 |
| `ram_total` / `ram_used`                      | number             | MB                        |
| `swap_total` / `swap_used`                    | number             | MB                        |
| `disk_total` / `disk_used`                    | number             | MB                        |
| `disk`                                        | object             | 磁盘 IO 当前值：`read_bps` / `write_bps` 为 B/s，`read_iops` / `write_iops` 为 ops/s，`await_ms` 为 ms，`util` 为 %；旧探针、旧历史缺失，或 6 个子字段全为 0 时不返回该对象 |
| `cpu_cores`                                   | number             | 逻辑核心数                     |
| `cpu_info`                                    | string             | CPU 型号                    |
| `gpu_info`                                    | array\|string\|null | GPU 列表。实时上报 / WebSocket 可能是 `[{id,name,info}]` 数组；REST 详情和历史接口通常是同结构的 JSON 字符串，其中 `info` 为占用率 |
| `arch`                                        | string             | 架构                        |
| `os`                                          | string             | OS 名称                     |
| `kernel_version`                              | string             | 内核版本                    |
| `agent_version`                               | string             | 最新一次上报的探针版本号              |
| `region`                                      | string             | `request.cf.country` 或 `cf-ipcountry` 的原始值；通常为大写两字母国家/地区代码 |
| `ip_v4`                                       | string `"0"`/`"1"` | 公共 REST 接口仅返回 IPv4 可达性，不暴露公网地址 |
| `ip_v6`                                       | string `"0"`/`"1"` | 公共 REST 接口仅返回 IPv6 可达性，不暴露公网地址 |
| `boot_time`                                   | string             | 启动时间（毫秒）                  |
| `last_updated`                                | number             | 最新指标记录的 `timestamp`（毫秒） |
| `is_online`                                   | boolean            | 5 分钟内是否有上报（仅 `list` 接口计算） |
| `sysConfig`                                   | object             | 站点级开关（仅部分接口附带）            |

### 5.2 Metrics 对象（探针上报 payload）

> 见 [§1.1 metrics 字段表](#11-post-update---指标上报agent-入口)。后端接受字符串或数值，官方 Bash / PowerShell 探针的具体类型并不完全一致；当前 GPU 数据统一使用 `gpu_info`，不返回独立 `gpu` 字段。

### 5.3 History Row 对象

| 字段          | 类型             | 说明 |
| ----------- | -------------- | ---- |
| `timestamp` | number (ms)    | 采样时间 |
| 其余字段        | number\|string\|null | 当前 `/api/history/all` 固定返回：`cpu, gpu_info, ram_total, ram_used, disk_total, disk_used, disk_read_bps, disk_write_bps, disk_read_iops, disk_write_iops, disk_await_ms, disk_util, processes, net_in_speed, net_out_speed, tcp_conn, udp_conn, ping_ct, ping_cu, ping_cm, ping_bd, loss_ct, loss_cu, loss_cm, loss_bd, swap_total, swap_used, load_avg, region, kernel_version`；其中 `gpu_info` 通常是 JSON 数组字符串，`disk` 仅在 `disk_*` 历史列存在有效数据时由服务端还原 |

历史行不包含单独的 `gpu` 字段，只包含 `gpu_info`。

### 5.4 Settings 对象

> ~~`get_settings` 直接返回 `site_options` 的全部字段，包括 `jwt_secret`。~~ **2026-07-26 修订**：返回前会明确删除 `jwt_secret`，但 `cloudflare_token`、密码哈希、Turnstile Secret 等其他敏感字段仍可能返回，请只通过 HTTPS 调用并严格保护管理 JWT。

```ts
{
  site_title: string,
  custom_bg: string,
  custom_head: string,           // 注入到 </head> 之前
  custom_script: string,         // 注入到 </body> 之前
  csp_static: string,            // 额外静态资源来源
  csp_api: string,               // 额外 API/WebSocket 来源
  display_mode: 'bar' | 'ring' | 'table',
  theme_options: Record<string, unknown>,
  theme_url: string,             // 第三方主题商店 URL；为空使用内置主题
  is_public: 'true' | 'false',
  show_price: 'true' | 'false',
  show_expire: 'true' | 'false',
  show_tf: 'true' | 'false',
  frontend_ws_timeout_minutes: string, // '0'-'1440'；0 = 不超时
  long_history_points: '60' | '120' | '180' | '240',
  tg_notify: '0' | '2' ... '30',    // 0 = 关闭；旧值 false 兼容为 0，true 兼容为 5
  tg_bot_token: string,
  tg_chat_id: string,
  turnstile_enabled: 'true' | 'false',
  turnstile_login_enabled: 'true' | 'false',
  turnstile_site_key: string,
  turnstile_secret_key: string,
  username: string,
  password: string,              // PBKDF2 哈希值；旧版 MD5 哈希会在成功登录后自动升级
  cloudflare_account_id: string,
  cloudflare_token: string,
  custom_ct: string,             // 电信测速节点 host[:port]
  custom_cu: string,             // 联通 host[:port]
  custom_cm: string,             // 移动 host[:port]
  custom_bd: string,             // BGP host[:port]
  expire_reminder: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7',
  notification_timezone: string, // IANA timezone；默认 UTC
  expire_notification_time: string, // '0'-'23'；默认 12
  history_id_optimized: 'true' | 'false',
  servers_optimized: 'true' | 'false'
}
```

`jwt_secret` 可通过 `save_settings` 写入，但不会由 `get_settings` 返回；只有长度至少 32 的值有效，空值或短值会在后续加载时被随机密钥替换。

### 5.5 WebSocket 消息

| `type`   | 方向    | Payload                                            |
| -------- | ----- | -------------------------------------------------- |
| `hello`  | S → C | `{ ts: number, subscribed: string }`               |
| `subscribe` | C → S | `{ scope: string, ids: string[] }`              |
| `subscribed` | S → C | `{ ts: number, subscribed: string, count: number }` |
| `ping`   | C → S | 精确文本 `{"type":"ping"}`                       |
| `pong`   | S → C | 自动响应的精确文本 `{"type":"pong"}`，不带 `ts`   |
| `batchUpdate` | S → C | `{ ts: number, updates: Array<{ serverId: string, samples: Array<{ ts: number, data: Partial<Server> }> }> }` |
| `update` | C → S | `/update` WSS 上报可选包装格式：`{ type:"update", id:string, secret:string, payload:{ metrics?:object, samples?:array, batch?:array } }` |
| `ack` | S → C | `/update` WSS 上报确认：`{ ts:number, persisted?:boolean, nextD1WriteAfterMs?:number, nextWssReportAfterMs?:number, correction?:true, config_schema?:number, config_md5?:string, has_config?:boolean, body?:string, config_body?:string, payload?:object }` |
| `error` | S → C | `/update` WSS 上报错误：`{ ts:number, error:string, code:number }`；随后服务端通常以 close code `1008` 关闭连接 |

客户端发来的 `pong` 会被静默忽略；它不是服务端定时发送的双向心跳协议。

***

## 6. 定时任务 (Cron)

Worker 同时注册了 cron 触发器（`scheduled` handler），可在 `wrangler.toml` 配置：

| Cron          | 行为              | 备注                                                             |
| ------------- | --------------- | -------------------------------------------------------------- |
| `*/1 * * * *` | 每分钟：检测离线节点、资源告警 | `checkOfflineNodes`、`checkResourceAlerts`（通知） |
| `0 * * * *`   | 每小时：根据 UTC 日期分支 | 见下表                                                            |
| <br />        | 每周日 0 点：表轮换    | `weeklyCleanup`（删除旧表、重命名 metrics\_history → metrics\_history\_old、创建新表） |
| <br />        | 每小时按通知时区/到期通知小时判断是否执行到期检测 | `checkExpiringServers` |

每周日 00:00–00:04 UTC 的表轮换窗口内，分钟任务会跳过离线节点检测。

DEBUG 模式（`env.DEBUG=1`）下额外提供：

- `0 0 * * 0` → weeklyCleanup
- `0 12 * * *` → checkExpiringServers（DEBUG 手动路径；常规定时在每小时任务里按 `notification_timezone` + `expire_notification_time` 执行）

***

## 7. 错误码速查表

| code | 名称                    | 触发条件                                        |
| ---- | --------------------- | ------------------------------------------- |
| 400  | Bad Request           | 缺参数 / 非法 UUID / 未知 action / 缺 Cloudflare 配置 / `invalidThemeUrl` |
| 401  | Unauthorized          | JWT 失败 / Basic 失败 / 站点非公开未登录 / 探针 secret 错  |
| 403  | Forbidden             | Turnstile 失败                                |
| 404  | Not Found             | 服务器不存在；~~也表示 WebSocket DO 未绑定。~~ **2026-07-26 修订**：DO 未绑定使用 `503` |
| 409  | Conflict              | ~~`DATABASE_UPGRADE_REQUIRED`~~ **2026-07-26 修订**：D1 缺字段时响应消息为 `databaseUpgradeRequired` |
| 500  | Internal Server Error | 未捕获异常 / DB 抛错                               |
| 503  | Service Unavailable   | WebSocket 未启用或 Durable Object 未绑定          |

***

## 8. 完整 cURL 示例

> 假设部署在 `https://status.example.com`，`API_SECRET=abc123`，服务器 ID 为 `9b2c4d3e-1a2b-4c5d-9e8f-7a6b5c4d3e2f`。

### 8.1 探针上报

```bash
curl -X POST https://status.example.com/update \
  -H "Content-Type: application/json" \
  -d '{
    "id":"9b2c4d3e-1a2b-4c5d-9e8f-7a6b5c4d3e2f",
    "secret":"abc123",
    "metrics":{
      "cpu":"12.34","ram_total":"8192","ram_used":"3700",
      "swap_total":"2048","swap_used":"100",
      "disk_total":"102400","disk_used":"32000",
      "disk":{"read_bps":4096,"write_bps":2048,"read_iops":12,"write_iops":8,"await_ms":1.5,"util":3.2},
      "load_avg":"0.10 0.20 0.30","boot_time":"1700000000000",
      "net_rx":"12345678","net_tx":"87654321",
      "net_rx_monthly":"1073741824","net_tx_monthly":"536870912",
      "net_in_speed":"1024","net_out_speed":"512",
      "os":"Ubuntu 22.04","arch":"x86_64","kernel_version":"6.8.0-36-generic","cpu_info":"Intel Xeon","cpu_cores":"4",
      "gpu_info":[{"id":"0","name":"NVIDIA GPU","info":12.5}],
      "processes":"256","tcp_conn":"32","udp_conn":"4",
      "ip_v4":"203.0.113.10","ip_v6":"2001:db8::10",
      "ping_ct":"23","ping_cu":"25","ping_cm":"30","ping_bd":"40"
    }
  }'
```

### 8.2 公共：获取配置

```bash
curl https://status.example.com/api/config
```

### 8.3 公共：首页服务器列表

```bash
curl https://status.example.com/api/servers
```

### 8.4 公共：单台详情

```bash
curl "https://status.example.com/api/server?id=9b2c4d3e-1a2b-4c5d-9e8f-7a6b5c4d3e2f"
```

### 8.5 公共：24h 历史

```bash
curl "https://status.example.com/api/history/all?id=9b2c4d3e-1a2b-4c5d-9e8f-7a6b5c4d3e2f&hours=24"
```

### 8.6 管理：登录

```bash
curl -X POST https://status.example.com/admin/api \
  -H "Content-Type: application/json" \
  -H "X-Turnstile-Token: <token>" \
  -d '{"action":"login","username":"admin","password":"abc123"}'
```

### 8.7 管理：列表（需 JWT）

```bash
TOKEN="eyJhbGc..."
curl -X POST https://status.example.com/admin/api \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"action":"list"}'
```

### 8.8 管理：添加服务器

```bash
curl -X POST https://status.example.com/admin/api \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"action":"add","name":"HK-02","server_group":"HK"}'
```

### 8.9 管理：编辑

```bash
curl -X POST https://status.example.com/admin/api \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"action":"edit","id":"9b2c4d3e-1a2b-4c5d-9e8f-7a6b5c4d3e2f","name":"HK-01","server_group":"HK","price":"35.00","billing_cycle":"month","auto_renewal":"1","currency":"¥","expire_date":"2027-01-01","reset_day":1,"collect_interval":0,"report_interval":60}'
```

### 8.10 管理：删除

```bash
curl -X POST https://status.example.com/admin/api \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"action":"delete","id":"9b2c4d3e-1a2b-4c5d-9e8f-7a6b5c4d3e2f"}'
```

### 8.11 管理：保存设置

```bash
curl -X POST https://status.example.com/admin/api \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "action":"save_settings",
    "settings":{
      "site_title":"My Status",
      "is_public":"true",
      "frontend_ws_timeout_minutes":"20",
      "long_history_points":"120",
      "turnstile_enabled":"true",
      "turnstile_site_key":"1x00000000000000000000AA",
      "turnstile_secret_key":"1x0000000000000000000000000000000AA"
    }
  }'
```

### 8.12 管理：D1 用量

```bash
curl -X POST https://status.example.com/admin/api \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"action":"d1_usage","cloudflare_account_id":"<account-id>","cloudflare_token":"<api-token>"}'
```

### 8.13 系统：数据库迁移

```bash
curl -X POST https://status.example.com/updateDatabase \
  -H "Authorization: Bearer $TOKEN"
```

### 8.14 健康检查

```bash
curl https://status.example.com/__do/health
```

### 8.15 WebSocket（使用 wscat / websocat）

```bash
# 订阅所有服务器
wscat -c "wss://status.example.com/api/ws?subscribe=all"
# 建连后发送：{"type":"subscribe","scope":"all","ids":["server-id"]}

# 订阅指定服务器
wscat -c "wss://status.example.com/api/ws?subscribe=9b2c4d3e-1a2b-4c5d-9e8f-7a6b5c4d3e2f"

# 私有站点：使用查询参数 JWT
wscat -c "wss://status.example.com/api/ws?subscribe=all&token=<jwt>"
```

### 8.16 公共：获取主题商店

```bash
curl https://status.example.com/theme
```

### 8.17 管理：发送测试通知

```bash
curl -X POST https://status.example.com/admin/api \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"action":"send_test_notification","tg_bot_token":"<bot-token>","tg_chat_id":"<chat-id>"}'
```

### 8.18 管理：导出服务器

```bash
curl -X POST https://status.example.com/admin/api \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"action":"export_servers"}'
```

### 8.19 管理：导入服务器

```bash
curl -X POST https://status.example.com/admin/api \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"action":"import_servers","servers":[{"id":"9b2c4d3e-1a2b-4c5d-9e8f-7a6b5c4d3e2f","name":"HK-01","server_group":"HK"}]}'
```

***

## 9. 版本与变更说明

- **2026-08-20**：新增 `frontend_ws_timeout_minutes` 站点设置与 `/api/config` 字段；默认 `0` 不超时，正整数表示前端实时订阅连接的分钟级寿命上限。
- **2026-07-26**：重新同步 `main` 源码；当前 Workers 版本为 `2.8.0 Beta`，Agent 版本为 `1.3.2`。补充主题商店、主题代理、最新批次缓存、测试通知、服务器导入/导出及探针动态配置，修正鉴权、历史查询、WebSocket、数据库维护和数据结构说明。
- ~~**v1.x**：当前文档对应早期 `src/index.js`、`src/handlers/*`、`src/database/schema.js` 主线实现。~~ **2026-07-26 修订**：文档现以 `2.8.0 Beta` 的 `main` 分支实现为准。
- **Breaking change**：`/admin/api` 由 `GET?action=...` 改为 `POST {action:...}` 模式，Token 校验与 Turnstile 走 Header 通道。
- **CORS**：普通 HTTP 响应通过 `CORS_ALLOWED_ORIGINS` 环境变量开启跨域；不配置时浏览器跨域读取会失败。WebSocket 握手的特殊行为见 [§0.6](#06-cors)。
- **JWT**：~~未配置 `jwt_secret` 时直接回退到 `API_SECRET` 派生值。~~ **2026-07-26 修订**：加载设置时会生成并持久化 32 字节随机密钥；`API_SECRET` 派生值和固定常量只作为数据库加载异常等兜底。
- **数据库升级**：升级到新字段（如 `loss_*`、`net_rx_monthly`、`reset_day` 等）后请调用 `POST /updateDatabase`；~~否则历史接口可能返回 `409 DATABASE_UPGRADE_REQUIRED`。~~ **2026-07-26 修订**：当前 409 响应体使用 `{ "message": "databaseUpgradeRequired" }`。

***

> 文档同步：与源码 `src/index.js`、`src/middleware/auth.js`、`src/handlers/{admin,dashboard,frontend,theme,update}.js`、`src/durable/MetricsBroadcaster.js`、`src/utils/{settings,errors,cors,csp,cache,metrics,common,serverBilling,version,latestReportCache,agentConfig}.js`、`src/database/{schema,updateDatabase}.js` 一一对应；后续修改任一文件时，请同步更新本文件。
