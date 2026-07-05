# CF-Server-Monitor 后端 API 文档

> 面向 CF-Server-Monitor 后端（Cloudflare Workers + D1 + Durable Objects）的完整 REST / WebSocket API 参考。
> 本文档覆盖所有公开端点、内部端点、鉴权机制、错误码、数据结构与 WebSocket 实时推送协议。
>
> **Base URL**：`https://<your-worker-domain>`（部署后由 Cloudflare Workers 提供）
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
- [3. 管理端 API（鉴权）](#3-管理端-api鉴权)
  - [3.1](#31-post-adminapi---管理操作入口) [`POST /admin/api`](#31-post-adminapi---管理操作入口) [- 管理操作入口](#31-post-adminapi---管理操作入口)
  - [3.2](#32-action-login---登录) [`action: login`](#32-action-login---登录) [- 登录](#32-action-login---登录)
  - [3.3](#33-action-get_settings---读取全部设置) [`action: get_settings`](#33-action-get_settings---读取全部设置) [- 读取全部设置](#33-action-get_settings---读取全部设置)
  - [3.4](#34-action-list---列出全部服务器含在线统计) [`action: list`](#34-action-list---列出全部服务器含在线统计) [- 列出全部服务器（含在线/统计）](#34-action-list---列出全部服务器含在线统计)
  - [3.5](#35-action-d1_usage---d1--workers-用量) [`action: d1_usage`](#35-action-d1_usage---d1--workers-用量) [- D1 / Workers 用量](#35-action-d1_usage---d1--workers-用量)
  - [3.6](#36-action-save_settings---保存设置) [`action: save_settings`](#36-action-save_settings---保存设置) [- 保存设置](#36-action-save_settings---保存设置)
  - [3.7](#37-action-add---新增服务器) [`action: add`](#37-action-add---新增服务器) [- 新增服务器](#37-action-add---新增服务器)
  - [3.8](#38-action-edit---修改服务器信息) [`action: edit`](#38-action-edit---修改服务器信息) [- 修改服务器信息](#38-action-edit---修改服务器信息)
  - [3.9](#39-action-delete---删除服务器) [`action: delete`](#39-action-delete---删除服务器) [- 删除服务器](#39-action-delete---删除服务器)
  - [3.10](#310-action-batch_delete---批量删除) [`action: batch_delete`](#310-action-batch_delete---批量删除) [- 批量删除](#310-action-batch_delete---批量删除)
  - [3.11](#311-action-save_order---保存服务器排序) [`action: save_order`](#311-action-save_order---保存服务器排序) [- 保存服务器排序](#311-action-save_order---保存服务器排序)
- [4. 系统维护端点](#4-系统维护端点)
  - [4.1](#41-post-updatedatabase---数据库迁移) [`POST /updateDatabase`](#41-post-updatedatabase---数据库迁移) [- 数据库迁移](#41-post-updatedatabase---数据库迁移)
  - [4.2](#42-post-rebuild---数据库重建) [`POST /rebuild`](#42-post-rebuild---数据库重建) [- 数据库重建](#42-post-rebuild---数据库重建)
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

项目使用 **三套并行的鉴权机制**，按接口范围区分使用。

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
  4. 用户名：若 `site_options.username` 已设置则用之，否则使用 `API_USER_NAME` 环境变量，最终回退为 `admin`
- **失败返回**：`401 { "error": "Invalid username or password", "code": 401 }`

#### C. JWT Bearer（管理操作 → 后续管理请求）

- **使用位置**：所有非 `login` 的 `POST /admin/api`、`POST /updateDatabase`、`POST /rebuild`
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
5. **验证成功后**，Worker 通过 `X-Turnstile-Verified` 这个 **加密 Header** 给客户端发"已验证凭证"（AES-GCM 加密、`API_SECRET`/`TURNSTILE_SECRET_KEY` 派生密钥、有效期 **3600 秒**），后续可省略 `X-Turnstile-Token`。
6. 客户端也可以把 `X-Turnstile-Verified` 再次带回，Worker 会优先验证该 Header（验证有效期）。

**相关请求/响应 Header**：

| Header                 | 方向              | 含义                                                                                 |
| ---------------------- | --------------- | ---------------------------------------------------------------------------------- |
| `X-Turnstile-Token`    | Client → Server | 当次 Turnstile token（明文）                                                             |
| `X-Turnstile-Verified` | 双向              | AES-GCM 加密的 `{ expires: <unix+3600>, verified: true, timestamp: <ms> }`，base64 字符串 |

**失败返回**：`403 { "error": "Turnstile verification failed", "code": 403 }`

### 0.3 统一响应格式

**成功响应**：

```json
{
  // 业务字段，结构因接口而异
  "success": true,
  ...
}
```

> 注：项目里"成功响应"是直接 `JSON.stringify` 业务对象，**没有固定的** **`code`** **字段**。HTTP 状态码始终为 `200`。

**成功响应特例**：

- `POST /update` → 纯文本 `OK`（`Content-Type: text/plain`）
- WebSocket 升级 → `101 Switching Protocols`

**错误响应**：

```json
{
  "error": "human readable message",
  "code": 400
}
```

> `code` 字段是 HTTP 状态码的镜像，便于前端无需读取 status 即可分流。

### 0.4 统一错误码

| code | 含义                    | 常见场景                                               |
| ---- | --------------------- | -------------------------------------------------- |
| 400  | Bad Request           | 参数缺失/类型错/UUID 不合法/未知 action                        |
| 401  | Unauthorized          | 缺/错 token、账号密码错、站点非公开且未登录                          |
| 403  | Forbidden             | Turnstile 验证失败                                     |
| 404  | Not Found             | 服务器 ID 不存在                                         |
| 409  | Conflict              | `DATABASE_UPGRADE_REQUIRED`，需先调用 `/updateDatabase` |
| 500  | Internal Server Error | DB 异常等未捕获错误                                        |
| 503  | Service Unavailable   | WebSocket 不可用（未绑定 DO）                              |

### 0.5 限流与配额

- Cloudflare Workers / D1 的硬性限额由 Cloudflare 平台强制（**D1：500 万行读 / 10 万行写 / 日；Workers：10 万次请求 / 日**）。
- `/admin/api?action=d1_usage` 可查询当前账户当日用量与近 24h 用量。

### 0.6 CORS

环境变量 `CORS_ALLOWED_ORIGINS`，**逗号分隔**的源白名单，例如：

```
CORS_ALLOWED_ORIGINS=https://status.example.com,https://admin.example.com
```

- 当请求 `Origin` 命中白名单 → 响应带 `Access-Control-Allow-Origin: <origin>`、`Access-Control-Allow-Credentials: true`、`Vary: Origin`。
- 预检请求 `OPTIONS` → 直接返回 `204`，并回显 `Access-Control-Request-Method` / `Access-Control-Request-Headers`，缓存 86400 秒。
- 未配置或未命中 → 不会下发 CORS Header，浏览器侧会被同源策略拦截。

***

## 1. 探针上报接口

### 1.1 `POST /update` - 指标上报（Agent 入口）

> **调用方**：服务器侧探针（[Bash install.sh](../public/install.sh) / [Windows cf-server-monitor.pyw](../public/cf-server-monitor.pyw)）。
> **鉴权**：`secret` 字段 == `env.API_SECRET`
> **Turnstile**：不参与

**Request**

- Method：`POST`
- Path：`/update`
- Headers：
  ```
  Content-Type: application/json
  ```
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
      "cpu_info": "Intel(R) Xeon(R) CPU",
      "cpu_cores": "4",
      "gpu": 12.5,
      "gpu_info": "NVIDIA GeForce RTX 3060",
      "processes": "256",
      "tcp_conn": "32",
      "udp_conn": "4",
      "ip_v4": "1",
      "ip_v6": "1",
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

  新版探针也可以一次上报多个采集样本，后端兼容旧的单条 `metrics` 格式。批量格式示例：

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
    "report_interval": 60
  }
  ```

**字段说明（metrics）**：

| 字段               | 类型           | 单位  | 必填 | 说明                                          |
| ---------------- | ------------ | --- | -- | ------------------------------------------- |
| `cpu`            | string       | %   | 是  | CPU 占用率，保留 2 位小数                            |
| `ram_total`      | string       | MB  | 是  | 内存总容量                                       |
| `ram_used`       | string       | MB  | 是  | 内存已用                                        |
| `swap_total`     | string       | MB  | 是  | Swap 总容量                                    |
| `swap_used`      | string       | MB  | 是  | Swap 已用                                     |
| `disk_total`     | string       | MB  | 是  | 磁盘总容量                                       |
| `disk_used`      | string       | MB  | 是  | 磁盘已用                                        |
| `load_avg`       | string       | -   | 是  | 三个浮点，空格分隔                                   |
| `boot_time`      | string       | 毫秒  | 是  | 系统启动时间（Unix ms）                             |
| `net_rx`         | string       | 字节  | 是  | 累计接收字节                                      |
| `net_tx`         | string       | 字节  | 是  | 累计发送字节                                      |
| `net_rx_monthly` | string       | 字节  | 是  | 当月累计下行                                      |
| `net_tx_monthly` | string       | 字节  | 是  | 当月累计上行                                      |
| `net_in_speed`   | string       | B/s | 是  | 实时下行速度                                      |
| `net_out_speed`  | string       | B/s | 是  | 实时上行速度                                      |
| `os`             | string       | -   | 是  | 操作系统                                        |
| `arch`           | string       | -   | 是  | 系统架构                                        |
| `cpu_info`       | string       | -   | 是  | CPU 型号                                      |
| `cpu_cores`      | string       | -   | 是  | 逻辑核心数                                       |
| `gpu`            | number\|null | %   | 否  | GPU 占用（Linux 探针可从 nvidia-smi / rocm-smi 读取） |
| `gpu_info`       | string\|null | -   | 否  | GPU 型号                                      |
| `processes`      | string       | -   | 是  | 进程数                                         |
| `tcp_conn`       | string       | -   | 是  | TCP 活跃连接数                                   |
| `udp_conn`       | string       | -   | 是  | UDP 套接字数                                    |
| `ip_v4`          | string       | -   | 是  | `1`/`0`，IPv4 可达性                            |
| `ip_v6`          | string       | -   | 是  | `1`/`0`，IPv6 可达性                            |
| `ping_ct`        | string       | ms  | 否  | 电信节点延时，**空字符串表示未取到**                        |
| `ping_cu`        | string       | ms  | 否  | 联通节点延时                                      |
| `ping_cm`        | string       | ms  | 否  | 移动节点延时                                      |
| `ping_bd`        | string       | ms  | 否  | BGP 节点延时                                    |
| `loss_ct`        | string       | %   | 否  | 电信丢包率                                       |
| `loss_cu`        | string       | %   | 否  | 联通丢包率                                       |
| `loss_cm`        | string       | %   | 否  | 移动丢包率                                       |
| `loss_bd`        | string       | %   | 否  | BGP 丢包率                                     |

**Response**

- 成功 `200 OK`：
  ```
  OK
  ```
  （`Content-Type: text/plain`）
- 失败：
  ```json
  { "error": "Invalid secret", "code": 401 }
  { "error": "Server not found", "code": 404 }
  ```

**副作用**

1. `metrics_history` 只写入本次请求中最新的一个样本，避免 1 秒采集时放大 D1 写入次数。
2. 新版历史表使用 `servers.history_partition_id + "0" + UTC yyyyMMddHHmmss` 作为整数 `id` 主键，例如分区 `1` 在 `2026-07-05T11:46:50Z` 写入 `1020260705114650`。
3. 触发 Durable Object `MetricsBroadcaster` 内部广播，统一发送 `{type:"batchUpdate", ts, updates:[...]}` 格式，前端按样本时间逐个回放。
4. 写入 `request.cf.country`（或 `cf-ipcountry` Header）作为该条记录的 `region` 字段（统一转大写）。

***

## 2. 公开 API（前端/管理端共用）

> 以下接口除 `/api/ws` 外，若 `site_options.is_public !== 'true'` 则**必须**携带 JWT（`Authorization: Bearer <token>`）才能访问。
> 命中 Turnstile 时需带 `X-Turnstile-Token` 或 `X-Turnstile-Verified`。

### 2.1 `GET /api/config` - 获取站点配置

**Request**

- Method：`GET`
- Path：`/api/config`
- Headers（可选）：
  ```
  X-Turnstile-Token: <token>   # 当携带时，验证后会回写 X-Turnstile-Verified
  X-Turnstile-Verified: <encrypted>
  ```

**Response** `200 OK`

```json
{
  "turnstile_enabled": true,
  "turnstile_site_key": "1x00000000000000000000AA",
  "verified": false,
  "turnstile_verified": "BASE64_AES_GCM_ENCRYPTED_STRING_OR_NULL",
  "show_long_history": true
}
```

| 字段                   | 类型           | 说明                                     |
| -------------------- | ------------ | -------------------------------------- |
| `turnstile_enabled`  | boolean      | 站点是否启用人机验证                             |
| `turnstile_site_key` | string       | Turnstile 前端公钥；前端拿到后渲染 widget          |
| `verified`           | boolean      | 当前请求是否携带了有效的 `X-Turnstile-Verified`    |
| `turnstile_verified` | string\|null | 当次验证成功后回写给客户端的"已验证凭证"，客户端应回存并在 1 小时内复用 |
| `show_long_history`  | boolean      | 是否允许查看超过 1 小时的历史曲线（未登录用户**强制** 1 小时上限） |

> `X-Turnstile-Token` 携带且验证成功时，响应头会同步设置 `X-Turnstile-Verified`（加密串）。

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
    "show_bw": true,
    "show_tf": true,
    "site_title": "My Server Monitor"
  }
}
```

| 字段            | 说明                                                                    |
| ------------- | --------------------------------------------------------------------- |
| `servers`     | 已合并最新指标的服务器列表（按 `sort_order ASC`），未登录用户**自动过滤** **`is_hidden = '1'`** |
| `stats`       | 聚合统计：在线阈值 300 秒（5 分钟无上报视为离线）                                          |
| `regionStats` | 按 ISO 区域码（大写）统计的服务器数                                                  |
| `sysConfig`   | 当前站点开关，前端据此显示对应 UI                                                    |

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
  "price": "￥30/月",
  "expire_date": "2026-12-31",
  "bandwidth": "1Gbps",
  "traffic_limit": "1TB",
  "traffic_calc_type": "total",
  "reset_day": 1,
  "collect_interval": 1,
  "report_interval": 60,
  "ping_mode": "http",
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
  "cpu_cores": 4,
  "cpu_info": "Intel(R) Xeon(R) CPU",
  "gpu": 12.5,
  "gpu_info": "NVIDIA GeForce RTX 3060",
  "arch": "x86_64",
  "os": "Ubuntu 22.04",
  "region": "HK",
  "ip_v4": "1",
  "ip_v6": "1",
  "boot_time": "1700000000000",
  "last_updated": 1737638400000,
  "timestamp": 1737638400000,
  "sysConfig": { "show_long_history": true }
}
```

**失败返回**：

- `400 { "error": "Missing ID" }` 缺少 `id`
- `404 { "error": "Server not found" }` 不存在 / 被隐藏（未登录访问时）

***

### 2.4 `GET /api/history/all` - 获取历史指标

**Request**

- Method：`GET`
- Path：`/api/history/all`
- Query：
  - `id`（**必填**）：服务器 UUID
  - `hours`（可选，默认 24）：浮点，**最大 168（7 天）**
- Headers（按需）：同 `/api/servers`

**Response** `200 OK`

```json
{
  "columns": ["timestamp", "cpu", "gpu", "gpu_info", "..."],
  "rows": [
    { "timestamp": 1737600000000, "cpu": 12.3, ... },
    { "timestamp": 1737600600000, "cpu": 13.1, ... }
  ]
}
```

**采样间隔（自动）**

| hours 范围  | 采样点间隔                  |
| --------- | ---------------------- |
| > 168     | 实际取 168h（7 天），步长 80 分钟 |
| 96 \~ 168 | 60 分钟                  |
| 48 \~ 96  | 40 分钟                  |
| 24 \~ 48  | 15 分钟                  |
| 12 \~ 24  | 10 分钟                  |
| 6 \~ 12   | 5 分钟                   |
| 1 \~ 6    | 1 分钟                   |
| ≤ 1       | 10 秒                   |

> 历史查询优先使用整数 `id` 主键范围（`history_partition_id0<cutoff>` 到 `history_partition_id099999999999999`）取数，并保留 `server_id` 精确过滤；随后用 `ROW_NUMBER() OVER (PARTITION BY ts/interval ORDER BY ts)` 取每个采样窗口的第一条。未升级的旧表会临时回退到 `server_id + timestamp` 条件。

**跨月查询**：当 `cutoff` 早于当月 1 号且存在 `metrics_history_old` 表时，自动 `UNION ALL` 两张表。

**缓存**：命中内存缓存时返回 `X-Cache: HIT`，反之 `MISS`。TTL 取决于 `hours`：

| hours | TTL   |
| ----- | ----- |
| ≥ 120 | 10 分钟 |
| ≥ 60  | 5 分钟  |
| ≥ 30  | 3 分钟  |
| < 30  | 1 分钟  |

**未登录限制**：`hours > 1` 时强制 `401`。

**数据库升级提示**：当 D1 缺少新字段时返回：

```json
HTTP 409
{ "code": "DATABASE_UPGRADE_REQUIRED" }
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
    - `<serverId>` → 只订阅指定服务器（**实时推送**）

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
| `subscribe=<serverId>` | 实时推送 | `batchUpdate` | 单台服务器详情页，低延迟，统一消息格式 |

> `subscribe=all` 默认不推送任何服务器更新。客户端应先调用 `/api/servers` 获取当前可见服务器列表，再通过 WebSocket 通道发送 `subscribe` 消息，使用 `servers[].id` 作为过滤列表。该过滤是客户端订阅范围控制，不是服务端鉴权。

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
             "data": { /* Server 对象 */ }
           },
           {
             "ts": 1737638399000,
             "data": { /* Server 对象 */ }
           }
         ]
       },
       {
         "serverId": "a1f3...",
         "samples": [
           {
             "ts": 1737638398500,
             "data": { /* Server 对象 */ }
           }
         ]
       }
     ]
   }
   ```

**客户端 → 服务端消息**（可选）：

```json
{ "type": "subscribe", "scope": "all", "ids": ["server-001", "server-002"] }
{ "type": "ping" }   // → 服务端回 { "type": "pong", "ts": ... }
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

**前端使用示例（subscribe=all，批量推送）**：

```js
const { servers } = await (await fetch('/api/servers')).json();
const ids = servers.map(s => s.id);
const ws = new WebSocket('wss://status.example.com/api/ws?subscribe=all');
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'subscribe', scope: 'all', ids }));
};
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'batchUpdate') {
    for (const u of msg.updates) {
      // 更新对应 serverId 的卡片
      updateServer(u.serverId, u.data);
    }
  }
};
```

**前端使用示例（subscribe=serverId，实时推送）**：

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
  { "action": "<one of: login|get_settings|list|d1_usage|save_settings|add|delete|batch_delete|edit|save_order>", ...payload }
  ```

**Turnstile**：

- 仅 `action: login` 启用 Turnstile 验证（请求头 `X-Turnstile-Token`）
- 其他 action：**不**走 Turnstile 流程（白名单 bypass）

**Response**：统一 `200 OK`，`Content-Type: application/json`，具体结构见下文各小节。

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

Header：`X-Turnstile-Token: <token>`（当 `site_options.turnstile_enabled === 'true'` 时**必填**）

**Response 200**

```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsImlhdCI6MTczNzYzODQwMCwiZXhwIjoxNzM4MjQzMjAwfQ.signature",
  "message": "loginSuccessful"
}
```

**Response 失败**

- `400 { "error": "Missing username or password" }`
- `401 { "error": "Invalid username or password" }`
- `403 { "error": "Turnstile verification failed" }`

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
    "total_ram": 360.5,
    "total_disk": 280.1,
    "total_net_in": 12345.6,
    "total_net_out": 7890.1,
    "avg_cpu": "12.04",
    "avg_ram": "45.06",
    "avg_disk": "35.01"
  }
}
```

| 字段             | 说明                      |
| -------------- | ----------------------- |
| `is_online`    | `true` = 最近 5 分钟内有上报    |
| `last_updated` | 最近一次上报时间戳（毫秒）           |
| `stats.avg_*`  | 仅按在线服务器平均，保留 2 位小数（字符串） |

> 注意：本接口**包含** `is_hidden=1` 的服务器（与 `/api/servers` 不同）。

***

### 3.5 `action: d1_usage` - D1 / Workers 用量

**Request**

```json
{ "action": "d1_usage" }
```

**前置条件**：`site_options.cloudflare_token` 与 `site_options.cloudflare_account_id` 必须已配置。

**Response 200**

```json
{
  "success": true,
  "usage": {
    "today": {
      "date": "2025-12-31",
      "rowsRead": 12345,
      "rowsWritten": 678,
      "readLimit": 5000000,
      "writeLimit": 100000,
      "readRemaining": 4987655,
      "writeRemaining": 99322,
      "workersRequests": 1234,
      "workersRequestLimit": 100000,
      "workersRequestRemaining": 98766,
      "databaseCount": 1,
      "accountId": "<cloudflare_account_id>"
    },
    "last24Hours": {
      "date": "2025-12-30 ~ 2025-12-31",
      "rowsRead": 23456,
      "rowsWritten": 789,
      "readLimit": 5000000,
      "writeLimit": 100000,
      "workersRequests": 2345,
      "workersRequestLimit": 100000,
      "databaseCount": 1,
      "accountId": "<cloudflare_account_id>"
    }
  }
}
```

**Response 失败**

- `400 { "error": "请先配置 Cloudflare Token" }` / `400 { "error": "请先配置 Cloudflare 用户 ID / Account ID" }`
- `400 { "error": "<Cloudflare GraphQL 错误信息>" }`

> 通过 Cloudflare GraphQL API（`https://api.cloudflare.com/client/v4/graphql`）查询：
>
> - `d1AnalyticsAdaptiveGroups`（`rowsRead` / `rowsWritten`）
> - `workersInvocationsAdaptive`（`requests`）

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
    "is_public": "true",
    "show_price": "true",
    "show_expire": "true",
    "show_bw": "true",
    "show_tf": "true",
    "show_long_history": "true",
    "tg_notify": "false",
    "tg_bot_token": "",
    "tg_chat_id": "",
    "turnstile_enabled": "false",
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
    "custom_bd": "lf3-ips.zstaticcdn.com",
    "cleanup_skip_count": "0",
    "expire_reminder": "false"
  }
}
```

**字段分类**：

- `APPEARANCE_FIELDS`（写入 `appearance_options` JSON）：`site_title`、`custom_bg`、`custom_head`、`custom_script`
- `SITE_FIELDS`（写入 `site_options` JSON）：上表除 appearance 之外的全部
- 任何未列出的字段会被忽略

**特殊处理**：

- `password`：以**明文**传入；后端用 PBKDF2-HMAC-SHA-256（50,000 iterations、16 字节 salt、32 字节 hash）计算后保存为 `pbkdf2_sha256$50000$<salt hex>$<hash hex>`；如传空字符串则**不更新**密码；旧版 32 位 MD5 哈希仍可登录并会在成功登录后自动升级

**Response 200**

```json
{ "success": true, "message": "updateSuccess" }
```

> 副作用：清空 `site_options` 内存缓存，下一次请求会从 DB 重新加载。

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

- `name`：1 \~ 100 字符，否则 `400 { "error": "服务器名称无效" }`
- `server_group`：默认 `Default`
- `sort_order`：自动 = `MAX(sort_order) + 1`

***

### 3.8 `action: edit` - 修改服务器信息

**Request**

```json
{
  "action": "edit",
  "id": "<server UUID>",
  "name": "HK-01",                   // 可选，1~100 字符
  "server_group": "HK",               // 默认 "Default"
  "price": "￥30/月",                  // 字符串
  "expire_date": "2026-12-31",
  "bandwidth": "1Gbps",
  "traffic_limit": "1TB",
  "traffic_calc_type": "total",       // total | ...
  "reset_day": 1,                     // 1 ~ 31
  "collect_interval": 1,              // 秒
  "report_interval": 60,              // 秒
  "ping_mode": "http",                // http | tcp
  "is_hidden": "0"                    // "0" | "1"
}
```

**Response 200**

```json
{ "success": true, "message": "serverUpdated" }
```

**Response 失败**

- `400 { "error": "服务器 ID 无效" }` —— UUID 格式错
- `500 { "error": "Update failed. Please go to Database Management and click \"Upgrade Database\" to migrate the new field." }` —— DB 缺字段，请先 `/updateDatabase`

***

### 3.9 `action: delete` - 删除服务器

**Request**

```json
{ "action": "delete", "id": "<server UUID>" }
```

**副作用**：级联删除该 server 的全部 `metrics_history` 记录。

**Response 200**

```json
{ "success": true, "message": "serverDeleted" }
```

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

***

### 3.11 `action: save_order` - 保存服务器排序

**Request**

```json
{ "action": "save_order", "orders": ["<uuid1>", "<uuid2>", "<uuid3>"] }
```

**说明**：

- `orders[i]` 表示该 UUID 排序后应为第 `i` 位（`sort_order = i`）
- 服务端会逐条 `UPDATE sort_order = ? WHERE id = ?`

**Response 200**

```json
{ "success": true, "message": "sortOrderSaved" }
```

***

## 4. 系统维护端点

> 以下端点需 JWT 鉴权（`Authorization: Bearer <token>`），不参与 Turnstile。

### 4.1 `POST /updateDatabase` - 数据库迁移

> 用于老版本升级时补齐 `metrics_history` 与 `servers` 表的字段，为服务器分配 `history_partition_id`，将历史表迁移为 `id INTEGER PRIMARY KEY NOT NULL`，并清理废弃 settings / 非主键索引。

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
    { "name": "metrics_history load -> load_avg 迁移", "success": true, "migrated": 1234, "message": "..." },
    { "name": "servers 表列更新", "success": true, "added": 5 },
    { "name": "servers 表多余字段清理", "success": true, "cleaned": 30, "message": "..." },
    { "name": "metrics_history 表列更新", "success": true, "added": 14 },
    { "name": "metrics_history id 主键迁移", "success": true, "migrated": true, "rows": 1234, "message": "..." },
    { "name": "metrics_history 非主键索引清理", "success": true, "dropped": 1, "message": "..." },
    { "name": "废弃 settings key 清理", "success": true, "cleaned": 0 },
    { "name": "删除弃用的 metrics_aggregated 表", "success": true, "dropped": 0, "message": "..." }
  ]
}
```

**失败返回**：`500` + `error` 字段（任一步骤抛错时整体失败）。

***

### 4.2 `POST /rebuild` - 数据库重建

> **危险操作**：会删除 `servers` / `metrics_history` / `metrics_history_old` / `settings` 全部数据后重建。

**Request**

- Method：`POST`
- Path：`/rebuild`
- Headers：`Authorization: Bearer <jwt>`

**Response 200**

```json
{ "success": true, "message": "databaseRebuiltSuccess" }
```

***

### 4.3 `GET /__do/health` - Durable Object 健康检查

**Request**

- Method：`GET`
- Path：`/__do/health`
- Headers：无需鉴权

**Response 200**

```json
{ "ok": true, "subscribers": 3 }
```

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
| `price`                                       | string             | 价格文本（自由格式）                |
| `expire_date`                                 | string             | 到期日 `YYYY-MM-DD`          |
| `bandwidth`                                   | string             | 带宽文本                      |
| `traffic_limit`                               | string             | 流量上限文本                    |
| `traffic_calc_type`                           | string             | `total` / 其他              |
| `reset_day`                                   | number             | 流量重置日 1\~31               |
| `collect_interval`                            | number             | 采集间隔（秒）                   |
| `report_interval`                             | number             | 上报间隔（秒）                   |
| `ping_mode`                                   | string             | `http` / `tcp`            |
| `is_hidden`                                   | string `"0"`/`"1"` | 是否在前台隐藏                   |
| `sort_order`                                  | number             | 排序值（越小越靠前）                |
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
| `ping_ct` / `ping_cu` / `ping_cm` / `ping_bd` | number\|null       | 各运营商延时 (ms)               |
| `loss_ct` / `loss_cu` / `loss_cm` / `loss_bd` | number\|null       | 各运营商丢包率 (%)               |
| `ram_total` / `ram_used`                      | number             | MB                        |
| `swap_total` / `swap_used`                    | number             | MB                        |
| `disk_total` / `disk_used`                    | number             | MB                        |
| `cpu_cores`                                   | number             | 逻辑核心数                     |
| `cpu_info`                                    | string             | CPU 型号                    |
| `gpu`                                         | number\|null       | GPU 占用%                   |
| `gpu_info`                                    | string             | GPU 型号                    |
| `arch`                                        | string             | 架构                        |
| `os`                                          | string             | OS 名称                     |
| `region`                                      | string             | 区域代码（大写，兼容 ISO 国家码）       |
| `ip_v4`                                       | string `"0"`/`"1"` | IPv4 可达性                  |
| `ip_v6`                                       | string `"0"`/`"1"` | IPv6 可达性                  |
| `boot_time`                                   | string             | 启动时间（毫秒）                  |
| `last_updated` / `timestamp`                  | number             | 上报时间戳（毫秒）                 |
| `is_online`                                   | boolean            | 5 分钟内是否有上报（仅 `list` 接口计算） |
| `sysConfig`                                   | object             | 站点级开关（仅部分接口附带）            |

### 5.2 Metrics 对象（探针上报 payload）

> 见 [§1.1 metrics 字段表](#11-post-update---指标上报agent-入口)。所有数值字段都是**字符串**（除了 `gpu`），方便 Bash 探针组装 JSON。

### 5.3 History Row 对象

| 字段          | 类型             | 说明                                                                                                                                                                                                                                               |
| ----------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `timestamp` | number (ms)    | 采样时间                                                                                                                                                                                                                                             |
| 其余字段        | 视查询 columns 而定 | 当前 `/api/history/all` 固定返回：`cpu, gpu, gpu_info, disk_total, disk_used, processes, net_in_speed, net_out_speed, tcp_conn, udp_conn, ping_ct, ping_cu, ping_cm, ping_bd, loss_ct, loss_cu, loss_cm, loss_bd, swap_total, swap_used, load_avg` |

### 5.4 Settings 对象

> `get_settings` 直接返回 `site_options` JSON 的**全部字段**（包括 `jwt_secret`、`cloudflare_token` 等敏感字段！请妥善保存并通过 HTTPS 调用）。

```ts
{
  site_title: string,
  custom_bg: string,
  custom_head: string,           // 注入到 </head> 之前
  custom_script: string,         // 注入到 </body> 之前
  is_public: 'true' | 'false',
  show_price: 'true' | 'false',
  show_expire: 'true' | 'false',
  show_bw: 'true' | 'false',
  show_tf: 'true' | 'false',
  show_long_history: 'true' | 'false',
  tg_notify: 'true' | 'false',
  tg_bot_token: string,
  tg_chat_id: string,
  turnstile_enabled: 'true' | 'false',
  turnstile_site_key: string,
  turnstile_secret_key: string,
  jwt_secret: string,            // 长度 ≥ 32 才会被用于签 JWT
  username: string,
  password: string,              // PBKDF2 哈希值；旧版 MD5 哈希会在成功登录后自动升级
  cloudflare_account_id: string,
  cloudflare_token: string,
  custom_ct: string,             // 电信测速节点域名
  custom_cu: string,             // 联通
  custom_cm: string,             // 移动
  custom_bd: string,             // BGP
  cleanup_skip_count: string,
  expire_reminder: 'true' | 'false'
}
```

### 5.5 WebSocket 消息

| `type`   | 方向    | Payload                                            |
| -------- | ----- | -------------------------------------------------- |
| `hello`  | S → C | `{ ts: number, subscribed: string }`               |
| `subscribe` | C → S | `{ scope: string, ids: string[] }`              |
| `subscribed` | S → C | `{ ts: number, subscribed: string, count: number }` |
| `ping`   | S → C | `{ ts: number }`                                   |
| `pong`   | 双向    | `{ ts: number }`                                   |
| `update` | S → C | `{ serverId: string, ts: number, data: <Server> }` |

***

## 6. 定时任务 (Cron)

Worker 同时注册了 cron 触发器（`scheduled` handler），可在 `wrangler.toml` 配置：

| Cron          | 行为              | 备注                                                             |
| ------------- | --------------- | -------------------------------------------------------------- |
| `*/1 * * * *` | 每分钟：检测离线节点      | `checkOfflineNodes`（通知）                                        |
| `0 * * * *`   | 每小时：根据 UTC 日期分支 | 见下表                                                            |
| <br />        | 每周日 0 点：表轮换    | `weeklyCleanup`（删除旧表、重命名 metrics\_history → metrics\_history\_old、创建新表） |
| <br />        | 每天 12 点：服务器到期检测 | `checkExpiringServers`                                         |

DEBUG 模式（`env.DEBUG=1`）下额外提供：

- `0 0 * * 0` → weeklyCleanup
- `0 12 * * *` → checkExpiringServers

***

## 7. 错误码速查表

| code | 名称                    | 触发条件                                        |
| ---- | --------------------- | ------------------------------------------- |
| 400  | Bad Request           | 缺参数 / 非法 UUID / 未知 action / 缺 Cloudflare 配置 |
| 401  | Unauthorized          | JWT 失败 / Basic 失败 / 站点非公开未登录 / 探针 secret 错  |
| 403  | Forbidden             | Turnstile 失败                                |
| 404  | Not Found             | 服务器不存在 / WebSocket DO 未绑定                   |
| 409  | Conflict              | `DATABASE_UPGRADE_REQUIRED`（D1 缺字段）         |
| 500  | Internal Server Error | 未捕获异常 / DB 抛错                               |
| 503  | Service Unavailable   | WebSocket 未启用                               |

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
      "load_avg":"0.10 0.20 0.30","boot_time":"1700000000000",
      "net_rx":"12345678","net_tx":"87654321",
      "net_rx_monthly":"1073741824","net_tx_monthly":"536870912",
      "net_in_speed":"1024","net_out_speed":"512",
      "os":"Ubuntu 22.04","arch":"x86_64","cpu_info":"Intel Xeon","cpu_cores":"4",
      "processes":"256","tcp_conn":"32","udp_conn":"4",
      "ip_v4":"1","ip_v6":"1",
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
  -d '{"action":"edit","id":"9b2c4d3e-1a2b-4c5d-9e8f-7a6b5c4d3e2f","price":"￥35/月","expire_date":"2027-01-01"}'
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
      "show_long_history":"true",
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
  -d '{"action":"d1_usage"}'
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
```

***

## 9. 版本与变更说明

- **v1.x**：当前文档对应 `src/index.js`、`src/handlers/*`、`src/database/schema.js` 主线实现。
- **Breaking change**：`/admin/api` 由 `GET?action=...` 改为 `POST {action:...}` 模式，Token 校验与 Turnstile 走 Header 通道。
- **CORS**：通过 `CORS_ALLOWED_ORIGINS` 环境变量开启；不配置时所有跨域请求会失败。
- **JWT**：`jwt_secret` 推荐配置为 ≥ 32 位的随机字符串；未配置时回退到 `API_SECRET` 派生，**部署后强烈建议**显式配置。
- **数据库升级**：升级到新字段（如 `loss_*`、`net_rx_monthly`、`reset_day` 等）后请调用 `POST /updateDatabase`；否则历史接口可能返回 `409 DATABASE_UPGRADE_REQUIRED`。

***

> 文档同步：与源码 `src/index.js`、`src/handlers/{admin,dashboard,frontend,update}.js`、`src/durable/MetricsBroadcaster.js`、`src/utils/{auth,settings,errors,cors,cache,metrics,common}.js`、`src/database/{schema,updateDatabase}.js` 一一对应；后续修改任一文件时，请同步更新本文件。
