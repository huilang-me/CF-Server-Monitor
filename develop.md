# CF-Server-Monitor 主题开发指南

> 本文档面向 AI 和开发者，描述如何从零构建一个 CF-Server-Monitor 前端主题。
>
> **不绑定任何框架**——你可用 React、Vue、Svelte、原生 JS 或任何方式实现。
>
> API 接口详见 [theme-develop.md](./theme-develop.md)。

---

## 目录

- [1. 架构概览](#1-架构概览)
- [2. 启动流程](#2-启动流程)
- [3. 首页（Dashboard）](#3-首页dashboard)
- [4. 服务器详情页](#4-服务器详情页)
- [5. 管理页面（Admin）](#5-管理页面admin)
- [6. 状态管理](#6-状态管理)
- [7. WebSocket 实时数据](#7-websocket-实时数据)
- [8. 主题与样式](#8-主题与样式)
- [9. 国际化](#9-国际化)
- [10. 关键算法](#10-关键算法)
- [11. 路由结构](#11-路由结构)

---

## 1. 架构概览

```
┌─────────────┐     HTTP / WebSocket     ┌─────────────────────┐
│  前端主题     │ ◄──────────────────────► │  Cloudflare Worker  │
│  (纯静态)    │                          │  (API 后端)          │
└─────────────┘                          └─────────────────────┘
       │                                         │
       │ fetch /config.json                      │ D1 数据库
       ▼                                         ▼
  public/config.json                      服务器指标数据
```

- 前端是**纯静态文件**，可部署到任何静态托管（GitHub Pages、Cloudflare Pages 等）
- 后端是 Cloudflare Worker + D1 数据库
- 前端通过 `config.json` 获取 API 地址，支持多后端聚合
- 路由使用 **Hash 模式**（`/#/`、`/#/server/:id`、`/#/admin`）

---

## 2. 启动流程

应用启动时按以下**严格顺序**执行，每一步依赖上一步的结果：

```
浏览器加载 index.html
│
├─ ① 加载 config.json（前端配置）
│    GET /config.json?t=<时间戳>  （cache: no-cache, credentials: omit）
│    → 获取 apiBase: string[]、title、backgroundImage
│    → 如果失败，使用 [window.location.origin] 作为默认 apiBase（始终是数组）
│
├─ ② 设置页面标题和背景图
│    document.title = title
│    document.body.style.backgroundImage = backgroundImage
│
├─ ③ 获取后端站点配置
│    单站模式：GET /api/config（单次请求）
│    多站模式：对所有 apiBase 并行 GET /api/config
│    → 获取 turnstile_enabled、verified、is_public、authorization、version
│    → 多站模式下如果任一站点开启 Turnstile → 显示"不支持"并停止
│
├─ ④ Turnstile 验证（如果启用且未验证）
│    首次请求 GET /api/config 携带 X-Turnstile-Verified（localStorage 中如有）
│    → 服务端返回 verified: true → 凭证有效，跳过验证，直接进入 ⑤
│    → 返回 verified: false → 需要验证，执行以下流程：
│       a. 动态加载 Turnstile SDK（render=explicit 模式）
│       b. 渲染验证组件，等待用户完成人机验证
│       c. 回调获取 token → 写入 localStorage("turnstile_token")
│       d. 清除请求缓存（invalidateCache）
│       e. 再次请求 GET /api/config，携带 X-Turnstile-Token header
│       f. 服务端验证 token，响应体返回 turnstile_verified（加密凭证）
│       g. 将 turnstile_verified 保存到 localStorage("turnstile_verified_{hostname}")
│       h. 删除 localStorage("turnstile_token")（一次性 token，用完即弃）
│    → 凭证有效期 1 小时，过期后服务端返回 403，自动清除凭证并重新走验证流程
│
├─ ⑤ 渲染应用框架
│    初始化路由、主题、基础布局
│
└─ ⑥ 路由跳转判断
     如果 !is_public && !authorization → 跳转到管理页登录
     移除页面 loading 动画
```

### 多站模式

当 `config.json` 中 `apiBase` 数组长度 > 1 时：
- 首页会向**所有后端**并行请求服务器列表并**合并**结果
- 每台服务器会标记 `source` 字段（来自哪个 apiBase）
- WebSocket 为每个 apiBase 创建**独立连接**，每个连接只传该后端的服务器 ID
- 管理页面**不可用**（显示禁用提示，列出各站点管理链接）

---

## 3. 首页（Dashboard）

### 3.1 数据加载顺序

```
页面挂载
│
├─ ① 恢复用户偏好
│    从 localStorage 读取上次的视图模式（card / table / map）
│
├─ ② 获取服务器列表
│    单站：GET /api/servers
│    多站：对所有 apiBase 并行 GET /api/servers，合并结果
│    → 返回 { servers[], stats, regionStats, sysConfig }
│
├─ ③ 计算全局统计
│    遍历 servers 计算：在线数、离线数、总流量、实时速度、地区分布
│    在线判定：last_updated 距今 < 5 分钟
│
├─ ④ 建立 WebSocket 实时连接
│    订阅模式：subscribe=all&ids=<所有服务器ID>
│    多站模式：为每个 apiBase 创建独立连接，每个只传该后端的 ID
│
├─ ⑤ 启动定时器
│    每秒更新一次相对时间（如"3分钟前"）
│    每秒推进服务器的 display_timestamp（回放缓冲）
│
└─ ⑥ 如果上次选择的是地图视图 → 初始化地图
```

### 3.2 需要渲染的 UI 元素

#### 顶部区域
- 终端风格标题栏（窗口按钮 + 站点标题 + 语言切换 + 主题切换 + 管理入口链接）

#### 导航区域
- 视图切换按钮：卡片 / 表格 / 地图
- 地区筛选标签栏：从 `regionStats` 生成，格式 `[全部] N  [US] 3  [JP] 2  [UNKNOWN] 1`
  - 每个标签显示国旗图标（`https://flagcdn.com/16x12/<country-code>.png`）
  - 特殊规则：TW/HK/MO 的国旗代码映射为 `cn`

#### 全局统计栏
- 服务器总数（在线数 | 离线数）
- 总流量（↓ 入站 | ↑ 出站）
- 实时速度（↓ N/s | ↑ N/s）

#### 卡片视图
- 按 `server_group` 分组，每组一个标题（`# 组名 [数量]`）
- 每张卡片包含：
  - 状态灯（绿=在线，红=离线）
  - 国旗 + 服务器名
  - 价格、到期时间（剩余天数 / 已到期）、带宽、流量配额
  - CPU / RAM / DISK 使用率进度条 + 百分比
  - 流量使用进度条（如果有 traffic_limit）
  - 实时网速（↓ N/s | ↑ N/s）
  - 累计流量（↓ N | ↑ N）
  - 时间戳（在线：采样时间 + 滞后秒数；离线：最后更新时间）
  - Ping 值（CT/CU/CM/BD），颜色：绿 < 100ms，黄 < 200ms，红 > 200ms，无效显示 Timeout

#### 表格视图
- 表头：状态 | 主机名 | 地区 | 系统/架构 | CPU | RAM | DISK | 流量使用 | 下载 | 上传 | 更新时间
- 每行显示进度条（CPU/RAM/DISK/流量使用）
- 点击行跳转到服务器详情

#### 地图视图
- 动态加载 Leaflet.js
- 加载世界 GeoJSON（`https://cdn.jsdelivr.net/npm/@surbowl/world-geo-json-zh@2.1.5/world.zh.json`）
- 按 `regionStats` 在对应国家高亮 + 标记服务器数量
- 国家坐标映射表（US、CN、JP、HK、SG 等 30+ 国家/地区）
- 主题切换时重绘标记颜色

### 3.3 实时更新机制

WebSocket 收到 `batchUpdate` 消息后，数据**不是立即应用**，而是进入回放缓冲：

```
收到 batchUpdate
  → 解析每个 serverId 的 samples
  → 过滤掉已过期的旧样本（时间戳 <= 当前已应用时间戳）
  → 单条样本：直接应用到 UI
  → 多条样本：存入缓冲队列，每秒 tick 时逐条应用

每秒 tick：
  → 推进每个在线服务器的 display_timestamp（+1秒）
  → 从缓冲队列取出到期的样本 → 更新服务器数据 → 重算统计
```

这样做的目的是让多条积压的数据**按时间顺序平滑播放**，而不是瞬间全部应用。

---

## 4. 服务器详情页

### 4.1 数据加载顺序

```
页面挂载（URL: /#/server/:id?apiIndex=N）
│
├─ ① 解析路由参数
│    serverId = 路由参数 :id
│    apiIndex = 查询参数 ?apiIndex（默认 0，多站模式下指定 apiBase 索引）
│    如果没有 serverId → 跳转回首页
│
├─ ② 获取服务器当前状态
│    GET /api/server?id=<uuid>（通过指定 apiBase 发送）
│    → 返回完整的 Server 对象
│    → 存入状态，设置 loading=false
│
├─ ③ 初始化图表（10 个 Chart.js 折线图）
│    等待 DOM 元素就绪后创建
│
├─ ④ 加载历史数据
│    GET /api/history/all?id=<uuid>&hours=0.167（默认 10 分钟）
│    → 填充所有图表
│
├─ ⑤ 监听主题变化
│    主题切换时更新图表轴标签颜色
│
└─ ⑥ 建立 WebSocket 连接
     订阅模式：subscribe=<serverId>（单服务器实时推送）
```

### 4.2 需要渲染的 UI 元素

#### 返回按钮 + 时间范围选择器
- 返回按钮：跳转回首页
- 时间范围按钮：10m / 30m / 1h / 6h / 12h / 24h
- 额外选项（需满足条件）：
  - 后端开启 `show_long_history` → 显示 2d / 4d / 7d
  - 多站模式 → 不显示超过 24h 的选项
- **超过 1 小时需要登录**，未登录时弹出登录提示模态框

#### 服务器信息卡
- 服务器名 + 国旗 + 在线/离线状态徽章
- 信息网格：
  - 运行时间（从 boot_time 计算）
  - 到期时间（剩余天数 / 已到期）
  - 系统 / 架构
  - CPU 信息（型号 x 核数）
  - GPU 信息（如有）
  - 总磁盘 / 总内存
  - 负载均值（1m 5m 15m）
  - 总流量（↓ / ↑）
  - 实时速度（↓ N/s / ↑ N/s）
  - 月度流量（如有）
  - 启动时间
  - 最后更新时间

#### 10 个图表

| 图表 | 数据来源 | Y 轴 | 多数据集 |
|------|---------|------|---------|
| CPU 使用率 | `cpu` | % | 否 |
| 负载均值 | `load_avg`（空格分隔 3 个值） | 数值 | 是（1m / 5m / 15m） |
| 内存使用率 | `ram_used / ram_total` + `swap_used / swap_total` | % | 是（RAM / Swap） |
| 磁盘使用率 | `disk_used / disk_total` | % | 否 |
| GPU 使用率 | `gpu`（有 gpu_info 时显示） | % | 否 |
| 网络流量 | `net_in_speed` / `net_out_speed` | B/s | 是（下载 / 上传） |
| 进程数 | `processes` | 数值 | 否 |
| 连接数 | `tcp_conn` / `udp_conn` | 数值 | 是（TCP / UDP） |
| 延迟监控 | `ping_ct / cu / cm / bd` | ms | 是（4 条线） |
| 丢包率 | `loss_ct / cu / cm / bd` | % | 是（4 条线） |

> 每个图表的颜色由主题自行定义，推荐使用 CSS 变量以便切换主题。

图表通用配置：
- X 轴：时间轴，范围 `[now - hours, now]`
- 数据点上限 500 个（超出时等间距采样）
- 间隙断裂：1 小时内数据间隔超过阈值时插入 null 断开连线
- 阈值：< 1h 间隔 5min 断裂，< 6h 间隔 10min，< 12h 间隔 15min，< 24h 间隔 20min，> 24h 间隔 30min

### 4.3 WebSocket 实时更新

- 订阅单个服务器：`subscribe=<serverId>`
- 收到 `update` 消息 → 只更新动态字段（CPU、RAM、网络等），**保留静态字段**（id、name、region、arch 等）不被覆盖
- 每次更新同时追加数据点到对应图表，裁剪超出时间范围的旧点

### 4.4 页面可见性处理

- 页面不可见（切后台）→ 关闭 WebSocket（节省资源）
- 页面重新可见 → 重连 WebSocket

---

## 5. 管理页面（Admin）

### 5.1 初始化流程

```
页面挂载（URL: /#/admin）
│
├─ 多站模式 → 显示禁用页面，列出各站点管理链接 → 结束
│
├─ 检查 localStorage 是否有 jwt_token
│   ├─ 有 → 已登录，直接加载设置和服务器列表
│   └─ 无 → 未登录：
│       ├─ 获取后端配置（Turnstile 状态）
│       ├─ 如果启用了 Turnstile → 加载 SDK → 渲染验证组件
│       └─ 显示登录表单
```

### 5.2 登录流程

```
用户提交用户名 + 密码
│
├─ 如果 Turnstile 启用 → 检查是否已验证
│   └─ 未验证 → 提示完成验证
│
├─ POST /admin/api { action: 'login', username, password }
│   ├─ 成功 → JWT token 存入 localStorage → 加载设置 + 服务器列表
│   └─ 失败 → 显示错误，清空密码，重置 Turnstile
```

### 5.3 三个 Tab 页

#### 服务器管理（Servers Tab）

操作列表：

| 操作 | API 调用 | 说明 |
|------|---------|------|
| 添加服务器 | `POST /admin/api { action: 'add', name, server_group }` | 需要输入名称 |
| 编辑服务器 | `POST /admin/api { action: 'edit', id, version, name, ... }` | 使用 version 乐观锁，冲突后重新加载 |
| 删除服务器 | `POST /admin/api { action: 'delete', id, version }` | 弹出确认框 + 卸载命令 |
| 批量删除 | `POST /admin/api { action: 'batch_delete', ids: [...], versions: {...} }` | 需先勾选 |
| 拖拽排序 | `POST /admin/api { action: 'save_order', orders: [id1, id2, ...] }` | HTML5 拖拽 |
| 复制安装命令 | 本地生成 | 弹出配置模态框 |

**安装命令生成**：
- HOST = `apiBases[0]`，secret = settings 返回的 `api_secret`
- 根据目标系统生成不同脚本：

| 目标系统 | 脚本 | Shell |
|---------|------|-------|
| Linux | `install.sh` | bash |
| Alpine | `install-alpine.sh` | sh |
| OpenWrt | `install-openwrt.sh` | sh |
| Windows | `cf-server-monitor.ps1` | PowerShell |

参数：`-id=<serverId> -secret='<secret>' -url=<HOST>/update -collect_interval=N -interval=N -ping=<http|tcp> -reset_day=N -ct=<node> -cu=<node> -cm=<node> -bd=<node> -rx_correction=N -tx_correction=N`

#### 系统设置（Settings Tab）

配置区域：

| 区域 | 字段 |
|------|------|
| 外观 | 站点标题、背景图（URL 或 base64 上传）、自定义 `<head>`、自定义脚本 |
| 显示选项 | 公开访问、显示价格/到期/带宽/流量配额/TIME、显示更多历史 |
| 通知 | 离线告警、到期提醒、Telegram Token、Chat ID |
| 安全设置 | Turnstile 开关 + Site Key + Secret Key、JWT Secret（≥32 字符） |
| Cloudflare | Account ID、API Token、D1 & Workers 用量查询 |
| 管理员账号 | 用户名、密码、确认密码 |
| Ping 节点 | CT/CU/CM/BD 自定义测试节点地址 |

**保存前验证规则**：
1. JWT Secret：如果填写了，必须 ≥ 32 字符且不含空白
2. 用户名：不能为空
3. 密码：如果填写了新密码，必须与确认密码一致
4. Turnstile：如果启用了，Site Key 和 Secret Key 都不能为空
5. 通知：如果启用了离线告警或到期提醒，Telegram Bot Token 不能为空

保存：`POST /admin/api { action: 'save_settings', versions: { site_options, appearance_options }, settings: { ... } }`
- 布尔值转为 `'true'`/`'false'` 字符串传输
- password 仅在用户输入了新密码时才包含
- 成功后刷新页面；若返回 `409 VERSION_CONFLICT`，重新加载最新设置并提示用户确认后重试

**背景图上传**：FileReader 读取为 base64 Data URL，> 800KB 时警告

**D1 用量查询**：`POST /admin/api { action: 'd1_usage' }` → 弹出模态框显示进度条

#### 数据库管理（Database Tab）

| 操作 | API 调用 | 说明 |
|------|---------|------|
| 升级数据库 | `POST /updateDatabase` | 更新数据库结构 |
| 重建数据库 | `POST /clearHistory` | 删除所有表重建（危险，二次确认） |

---

## 6. 状态管理

前端需要维护以下全局状态（概念层面，不限定实现方式）：

### 6.1 应用级状态

| 状态 | 类型 | 说明 |
|------|------|------|
| `apiBases` | string[] | API 后端地址列表 |
| `wsBase` | string | WebSocket 基地址（从 apiBases[0] 推导） |
| `title` | string | 页面标题 |
| `backgroundImage` | string | 背景图 URL |
| `currentTheme` | 'dark' \| 'light' \| 'auto' | 主题模式 |
| `currentLang` | 'en' \| 'zh' | 当前语言 |
| `jwtToken` | string \| null | 登录凭证（存 localStorage） |
| `turnstileToken` | string \| null | Turnstile 临时 token |
| `turnstileVerified` | string \| null | Turnstile 加密凭证（按 apiBase 缓存） |

### 6.2 首页状态

| 状态 | 类型 | 说明 |
|------|------|------|
| `servers` | Server[] | 服务器列表（含实时指标） |
| `stats` | object | 全局统计（total/online/offline/speed/traffic） |
| `regionStats` | object | 地区分布 `{ "US": 3, "JP": 2 }` |
| `sysConfig` | object | 显示开关（show_price/show_expire 等） |
| `currentView` | 'card' \| 'table' \| 'map' | 当前视图 |
| `currentFilter` | string | 地区筛选（'all' / 'us' / 'unknown' 等） |
| `liveConnected` | boolean | WebSocket 连接状态 |
| `playbackBuffers` | Map<serverId, Sample[]> | 回放缓冲队列 |
| `now` | number | 当前时间戳（每秒更新，驱动相对时间） |

### 6.3 详情页状态

| 状态 | 类型 | 说明 |
|------|------|------|
| `server` | Server | 当前服务器完整数据 |
| `currentHours` | number | 时间范围（小时数） |
| `charts` | object | Chart.js 图表实例集合 |
| `historyLoaded` | boolean | 历史数据是否已加载 |

### 6.4 管理页状态

| 状态 | 类型 | 说明 |
|------|------|------|
| `isLoggedIn` | boolean | 登录状态 |
| `servers` | Server[] | 服务器列表（管理用） |
| `settings` | object | 系统配置 |
| `activeTab` | 'servers' \| 'settings' \| 'database' | 当前 Tab |

---

## 7. WebSocket 实时数据

### 连接管理

```
首页（subscribe=all）：
  → 连接 wss://<wsBase>/api/ws?subscribe=all&ids=<id1,id2,...>
  → 收到 batchUpdate → 进入回放缓冲（见 3.3）
  → 多站模式：为每个 apiBase 创建独立连接

详情页（subscribe=<serverId>）：
  → 连接 wss://<wsBase>/api/ws?subscribe=<serverId>
  → 收到 update → 直接更新服务器数据 + 图表
```

### 重连策略

- 断线后自动重连，指数退避：1s → 2s → 4s → 8s → 16s → 30s（封顶）
- 最多重连 10 次
- 页面不可见时关闭连接，重新可见时重连

### 消息类型

| 类型 | 方向 | 用途 |
|------|------|------|
| `hello` | S→C | 连接确认 |
| `ping` / `pong` | 双向 | 心跳保活 |
| `update` | S→C | 单服务器实时更新（详情页用） |
| `batchUpdate` | S→C | 批量更新（首页用，每 5 秒一次） |

---

## 8. 主题与样式

### 8.1 主题模式

三种模式：`dark`（深色）、`light`（浅色）、`auto`（跟随系统）

实现方式：
- `auto` 模式监听 `prefers-color-scheme: dark` 媒体查询
- 主题切换通过 `document.body.classList` 添加/移除 `light` class
- 默认深色不需要添加 class（深色为默认样式）
- 用户偏好存入 `localStorage('theme_preference')`

### 8.2 样式变量体系

推荐使用 CSS 变量管理颜色，便于主题切换：

```css
:root {
  /* 语义化颜色变量，名称和值由主题自行定义 */
  --color-success: ...;   /* 在线状态、正常值 */
  --color-danger: ...;    /* 离线状态、异常值 */
  --color-warning: ...;   /* 警告值 */
  --color-info: ...;      /* 信息展示 */
  --color-muted: ...;     /* 次要文本 */
}
```

图表、状态灯、进度条、Ping 值颜色等均引用这些变量，切换主题时自动适配。

### 8.3 终端风格 UI

整体设计语言为终端/命令行风格：
- 等宽字体（JetBrains Mono / Courier New）
- 终端窗口装饰（红黄绿圆点）
- 命令行提示符风格（`$`、`#`、`root@`）
- 深色背景为主

---

## 9. 国际化

支持语言：`en`（英语）、`zh`（中文）

- 默认语言：`zh`
- 用户偏好存入 `localStorage('language_preference')`
- 切换语言时触发自定义事件通知所有组件更新
- 翻译 key 为固定字符串（如 `totalServers`、`online`、`offline` 等）

翻译 key 示例：

| key | en | zh |
|-----|----|----|
| totalServers | Total Servers | 服务器总数 |
| online | Online | 在线 |
| offline | Offline | 离线 |
| cards | CARDS | 卡片 |
| table | TABLE | 列表 |
| map | MAP | 地图 |
| loading | Loading... | 加载中... |
| noServer | No servers available | 暂无服务器 |
| adminLogin | Admin Login | 管理员登录 |
| login | Login | 登录 |
| logout | Logout | 退出 |

---

## 10. 关键算法

### 10.1 在线判定

```js
isOnline = (now - server.last_updated) < 5 * 60 * 1000  // 5 分钟
```

### 10.2 字节格式化

```js
formatBytes(bytes) → "1.23 GB"
// 按 1024 进位：B → KB → MB → GB → TB
// 保留 2 位小数
```

### 10.3 流量使用百分比

```js
calcType = server.traffic_calc_type  // 'total' | 'ul' | 'dl'
usedBytes = calcType === 'dl' ? net_rx_monthly
          : calcType === 'ul' ? net_tx_monthly
          : net_rx_monthly + net_tx_monthly
limitBytes = traffic_limit * 1024 * 1024 * 1024  // GB → Bytes
percent = (usedBytes / limitBytes) * 100
```

### 10.4 时间戳标准化

后端返回的时间戳可能是秒级或毫秒级：
```js
normalizeTimestamp(value):
  if value < 10000000000 → value * 1000（秒 → 毫秒）
  else → value（已是毫秒）
  如果是字符串 → new Date(value).getTime()
```

### 10.5 相对时间格式化

```
< 1秒  → "0秒前"
< 60秒  → "N秒前"
< 60分  → "N分钟前"
< 24时  → "N小时前"
< 30天  → "N天前"
其他    → 完整日期时间
```

### 10.6 Ping 颜色

```
无效（null / 0 / 空） → 红色（显示 Timeout）
< 100ms              → 绿色
< 200ms              → 黄色
≥ 200ms              → 红色
```

### 10.7 国旗代码映射

```js
getFlagRegionCode(region):
  TW / HK / MO → "cn"  // 特殊映射
  其他          → region.toLowerCase()
```

国旗图片 URL：`https://flagcdn.com/24x18/<code>.png`

### 10.8 WebSocket 地址推导

```js
从 apiBase URL 推导：
  https://xxx.com → wss://xxx.com
  http://xxx.com  → ws://xxx.com
```

---

## 11. 路由结构

使用 Hash 模式路由：

| 路由 | 页面 | 说明 |
|------|------|------|
| `/#/` 或 `/#` | Dashboard | 首页，服务器列表 |
| `/#/server/:id` | ServerDetail | 服务器详情，含图表 |
| `/#/admin` | Admin | 管理面板（登录/设置） |

查询参数：
- `?apiIndex=N`：多站模式下指定使用第 N 个 apiBase（从 0 开始）

---

## 附录：构建部署

### 本地开发

```bash
npm install
npm run dev    # Vite 开发服务器，https://localhost:5173
```

### 生产构建

```bash
API_BASE="https://api1.com,https://api2.com" \
TITLE="My Monitor" \
BACKGROUND_IMAGE="https://cdn.example.com/bg.webp" \
npm run build
```

环境变量自动生成 `public/config.json`，输出到 `dist/`。

### 部署清单

构建产物为纯静态文件，可部署到：
- GitHub Pages
- Cloudflare Pages
- Vercel / Netlify
- 任何静态文件服务器

必须一起部署的文件：
- `index.html`
- `assets/`（JS/CSS bundle）
- `config.json`（运行时配置）
