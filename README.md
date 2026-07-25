# [CF-Server-Monitor](https://github.com/huilang-me/CF-Server-Monitor)

一个基于 Cloudflare Workers + D1 + Durable Objects 的多服务器监控探针系统，支持实时监控、历史数据查看、延迟追踪、地图展示等功能。兼容主流 Linux 系统、Alpine Linux、OpenWrt、macOS（Intel / Apple Silicon）、群晖、Windows 系统。

**演示地址**：<https://demo.huilang.me/>

**当前Workers版本：V2.7.13 Beta4; Agent版本：1.3.3**

> [!IMPORTANT]
> V2.7.10 加入了 CSP 内容安全策略。默认只允许同源资源和必要的 Cloudflare/Google Fonts 资源；
> 
> 第三方背景图、外部 CSS/JS、字体、图片等资源会被浏览器拦截，需要在管理后台 → 外观 → CSP 设置中加入可信域名白名单后才能加载。
> 
> 这是基于安全考虑，用于降低 XSS、数据注入和未知第三方资源风险。

> [!NOTE]
> **对比其他探针的优势**
>
> - 免费托管在 Cloudflare，稳定性比自己服务器还高，超出免费额度也不扣费。目前支持 60+ 台监控，调整成 120 秒上报间隔后可以翻倍。
> - 安全：无 WebSSH、无命令下发、单向上报，没有所谓的“主控”；Workers 项目只是一个纯收集数据和展示的平台。
> - 客户端只需一个非常简单的 [install.sh](https://github.com/huilang-me/CF-Server-Monitor/blob/main/public/install.sh) 脚本，不依赖 Go 之类的语言，原生支持，非常轻量。
> - 其他探针该有的功能基本都有，后续将继续完善。

<details>
<summary>更新记录</summary>

- V2.7.13 Beta 新增显示模式选择功能，添加环形图模式，添加服务器导入导出功能，修复部分系统硬盘获取失败的bug，ping获取改成中位数。添加钉钉、OneBot (QQ) 通知支持，新增服务器计费相关字段与自动续费功能。新增JWT自动生成，修复Macos兼容，重构通知告警，简化首次安装流程。
- V2.7.12 新增Agent自动更新功能，默认关闭，谨慎开启。（本次更新需要手动升级agent安装脚本后才生效）
- V2.7.11 优化客户端探针脚本，减少服务器流量消耗，添加GitHub自动同步功能，实现Workers自动升级。增加了Workers/Agent版本升级提示。增加OS图标显示（本次更新需要手动升级agent安装脚本）
- V2.7.10 加入了 CSP 内容安全策略。重构前端 admin 模块，新增 iOS Scriptable 小组件，新增 tags、note 字段
- V2.7.9 修改数据库结构，减少一半D1写入消耗，理论上支持60+服务器监控，在保证安全的基础上，增加服务器参数下发功能。
- V2.7.8 修复月度任务导致数据表索引丢失的严重 Bug
- V2.7.7 添加GitHub Page部署支持，添加飞书，Bark通知支持
- V2.7.6 添加多站点支持，包括验证码登录等，添加 Windows PowerShell 无依赖安装脚本，一些安全优化
- V2.7.5 DO WebSocket改成 DO WebSocket Hibernation基本剔除DO Duration消耗，新增批量推送入口，每5秒批量接收多个服务器更新，减少 DO 请求次数。
- V2.7.4 添加允许跨域配置，为后续版本额外功能做铺垫，前端加上跨域配置，修改成HASH模式，修改country为region，数据库自动维护
- V2.7.3.3 压缩定时任务4个为2个，避免超出免费额度
- V2.7.3.2 合并通知告警，其他代码逻辑优化
- V2.7.3.1 当request.cf返回`cf object not available`错误，导致国家/地区代码获取失败，使用request.headers获取作为备选
- V2.7.3 新增服务器到期提醒功能，调整后台设置页面布局
- V2.7.2 新增支持多分区磁盘统计功能以及其他优化，增加[图文教程](https://huilang.me/cf-server-monitor-setup/)
- V2.7.1 新增国内四线路丢包率监控与历史图表，新增GPU字段与图表展示（GPU暂未测试），后台新增 Cloudflare D1/Workers 每日额度查询功能；
- V2.7.0 将每日数据清理改为每月1号执行的表轮换任务, 删除旧表将不再扣除D1消耗,前端图表支持查看最长7天的历史数据,优化脚本一键升级功能
- V2.6.10 修复了方式一部署方式，同步后丢失API\_SECRET的问题
- V2.6.9 修复地图显示问题，重构OpenWrt安装脚本，新增OpenRC服务支持
- V2.6.8 修复网卡统计误统计非目标网卡流量的问题,修复Alpine环境UDP连接数统计错误,本次更新需要重新安装脚本才能生效
- v2.6.7 增加了月流量统计校正功能，以及首页流量统计展示
- v2.6.6 增加上报间隔，Ping方式，流量重置日入库功能
- V2.6.5 修复了部分系统启动时间获取错误的问题，TCP/UDP上报格式错误导致失败问题，新增详情页面实时网速展示
- V2.6.4 增加了 **月流量统计** 功能，升级后请在后台手动点击 **升级数据库** 来更新数据库结构。不然会导致数据库结构错误，影响正常运行。同时需要在后台设置重置日期，并重新安装脚本。
- V2.6.3 应大家需求，增加自定义Ping设置
- V2.6.0 降低了 50% 的D1写入消耗，强烈建议升级，升级后请在后台手动点击 升级数据库 或者 重建数据库 。
- V2.5.0 增加客户端上报数据后，在不占用D1消耗的情况下，前端WebSocket实时刷新数据
- V2.4.0 版本主要优化了D1读写占用，使项目消耗大大降低，以及增加了防护避免被刷。

</details>

## ✨ 功能特点

- 📊 **实时监控**：CPU、GPU、内存、磁盘、网络、进程数、连接数、负载均衡
- 📈 **历史图表**：支持 7 天历史数据查看
- 🌍 **全球地图**：可视化展示服务器分布
- 🔔 **离线告警**：支持 Telegram、企业微信 / 飞书 / Bark / 钉钉 / OneBot 通知
- 📱 **响应式**：支持桌面端和移动端
- 🔄 **自动部署**：GitHub Actions 一键部署
- 🗺️ **网络质量追踪**：国内电信/联通/移动/字节延迟与丢包率监测
- 🔒 **服务器隐藏**：可设置特定服务器对非登录用户隐藏
- ↕️ **拖拽排序**：后台拖拽调整服务器显示顺序
- 🌐 **双语支持**：支持中文和英文界面自由切换
- 🧩 **多站点支持**：可配置多个 API 站点聚合展示，详情页与后台按站点独立访问
- 🧪 **本地测试**：支持本地模拟数据生成，方便开发和测试
- 🔐 **Turnstile 验证**：集成 Cloudflare Turnstile 人机验证，增强 API 安全性
- 🔑 **JWT 认证**：登录系统采用 JWT token 认证，支持自定义密钥
- 🛡️ **CSP 安全策略**：默认限制第三方静态资源加载，可在后台按需添加可信白名单
- 📉 **额度查询**：后台可查询 Cloudflare D1 当日读写行数与 Workers 请求量
- ⚡ **实时推送**：基于 Durable Objects + WebSocket，探针上报后页面立即刷新，无轮询延迟

## 🚀 快速开始

### 前置要求

- [Cloudflare 账户](https://dash.cloudflare.com/)
- [GitHub 账户](https://github.com/)

<details>
<summary>方式一：Cloudflare Workers 连接GitHub仓库（推荐使用，方便同步）图文教程 -> https://huilang.me/cf-server-monitor-setup/</summary>

### 第一步：Fork 项目

点击右上角 **Fork** 按钮，将项目 Fork 到你的 GitHub 账户。

### 第二步：新建 Cloudflare Workers

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)
2. 进入 **[Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)**
3. 点击 **Create application**
4. 选择 Continue with GitHub（第一次使用需要连接 GitHub 账户），选择本项目
5. Project Name填写：`cf-server-monitor`
6. Build command 填写：`npm run build:frontend`
7. Deploy command 保留默认值：`npx wrangler deploy`
8. 点击 **Deploy**，成功会在底部显示`✨ Success! Build completed.`

### 第三步：配置环境变量

1. 在当前Workers & Pages页面，点击 **Settings**
2. 在Variables and secrets找到API\_SECRET，点右侧编辑，填写密码（建议使用随机数,不要包含特殊字符比如%），点Deploy保存部署，等待30秒左右部署完成

</details>

<details>
<summary>方式二：GitHub Action 自动部署</summary>

### 第一步：Fork 项目

点击右上角 **Fork** 按钮，将项目 Fork 到你的 GitHub 账户。

### 第二步：创建 D1 数据库

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)
2. 进入 **[Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)**  → **[D1 SQL Database](https://dash.cloudflare.com/?to=/:account/workers/d1)**
3. 点击 **Create database**
4. 数据库名称填写：`server-monitor-db`
5. 点击 **Create**
6. 记录下生成的 **Database ID**，稍后会用到

### 第三步：获取 Cloudflare 配置

#### 获取 Account ID

**方式一：从右侧面板获取**

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/?to=/:account/workers-and-pages)
2. 在右侧面板找到 **Account ID**
3. 复制保存

**方式二：从 URL 中获取**

- 登录后访问任意 Cloudflare 页面，例如 [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)
- URL 中 `dash.cloudflare.com/` 之后的那串字符就是 Account ID

#### 获取 API Token

1. 打开 [API Tokens 页面](https://dash.cloudflare.com/profile/api-tokens)
2. 点击 **Create Token/创建令牌**
3. 选择（**Edit Cloudflare Workers/编辑 Cloudflare Workers**）模板
4. 在 **Account Resources/帐户资源** 选择你的账户
5. 点击 **Continue to summary/继续以显示摘要**→ **Create Token/创建令牌**
6. 复制生成的 Token（只显示一次！）

### 第四步：配置 GitHub Secrets

1. 打开你 Fork 的 GitHub 仓库
2. 进入 **Settings** → **Secrets and variables** → **Actions**
3. 点击 **New repository secret**，依次添加以下 5 个密钥：

| Secret 名称        | 值                  | 说明                                     |
| ---------------- | ------------------ | -------------------------------------- |
| `CF_API_TOKEN`   | 第三步获取的 Token       | Cloudflare API 令牌                      |
| `CF_ACCOUNT_ID`  | 第三步获取的 ID          | Cloudflare 账户 ID                       |
| `API_USER_NAME`  | 自定义用户名（非必填）        | 管理后台用户名 新版已移除，默认用户名admin               |
| `API_SECRET`     | API 认证密钥（必填）       | 探针认证密钥 & 默认管理后台密码 建议使用随机密码,不要包含特殊字符比如% |
| `D1_DATABASE_ID` | 第二步获取的 Database ID | D1 数据库 ID                              |
| `API_BASE`       | API 域名（非必填）        | 多站点模式下的 API 地址，多个用逗号分隔                    |
| `CSP_STATIC`     | 静态文件域名（非必填）       | 额外的 CSP 静态资源白名单，多个用逗号分隔；用于第三方背景图、CSS、JS、字体、图片等 |
| `CSP_API`        | API 域名（非必填）        | 额外的 CSP API 白名单，多个用逗号分隔；用于允许前端连接第三方 API/WebSocket |

### 第五步：部署

#### 方式一：自动部署

推送代码到 `main` 分支，GitHub Actions 会自动部署。在仓库的 **Actions** 标签页可查看部署进度。

#### 方式二：手动部署

也可以通过 GitHub Actions 手动触发部署：

1. 进入你的 GitHub 仓库页面
2. 点击顶部的 **Actions** 标签
3. 在左侧工作流列表中选择 **Deploy to Cloudflare Workers**
4. 点击右侧的 **Run workflow** 按钮
5. 选择分支（默认选择 `main`）
6. 点击 **Run workflow** 开始部署

部署进度可在 **Actions** 标签页中查看。

</details>

<details>
<summary>方式三：一键部署（比较简单，但不推荐，不方便更新）</summary>

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/huilang-me/CF-Server-Monitor)

新用户点击一键部署

修改`API_SECRET`，建议使用随机密码,不要包含特殊字符比如%，登录密码在登录后修改，建议和API\_SECRET不同。

在build command中填入 `npm run build:frontend`，其他保持默认

点击部署即可

</details>

## 📊 使用说明

<details>
<summary>访问管理后台</summary>

部署成功后，访问管理后台：

```
https://你的项目名.你的子域.workers.dev/#/admin
```

- 用户名：默认admin，如果设置了环境变量 `API_USER_NAME`，则使用该值
- 密码：你设置的 `API_SECRET`

**登录后务必修改用户名和密码，以确保安全。** 强烈建议登录密码和探针认证密钥不同。

> **提示**：项目名和子域可以在 Cloudflare Workers & Pages 页面找到。建议绑定域名，避免国内无法访问

</details>

<details>
<summary>添加服务器监控</summary>

### 在管理后台添加服务器

1. 进入管理后台 `/#/admin`
2. 在"服务器名称"输入框填写名称
3. 点击 **+ 添加服务器**
4. 点击新服务器旁的 **📋** 按钮复制安装命令

如需为单台设备设置反向代理入口或 HTTP(S) 代理，请先打开该服务器的编辑弹窗，在“探针网络”中填写：

- **探针 BaseURL**：统一提供安装脚本、`/update` 和自动更新脚本，支持路径前缀；留空使用当前管理面板选中的 API 地址。
- **HTTP(S) 代理**：仅代理探针到 BaseURL 的请求，可使用 URL 编码后的账号密码；Ping、测速节点、公网 IP 和地区检测保持直连。地区代码由探针直连获取，不使用代理出口的 Cloudflare 地理信息。

这两个配置只会进入新生成的安装命令。修改后必须重新复制并执行安装命令，已运行探针不会通过动态配置自动切换网络路径。

### 参数说明

| 参数                  | 说明                           | 默认值    |
| ------------------- | ---------------------------- | ------ |
| `-id`               | 服务器唯一标识符（必填）                 | -      |
| `-secret`           | API 认证密钥（必填）                 | -      |
| `-base_url`         | 探针 BaseURL（脚本、`/update`、自动更新） | 当前 API 地址 |
| `-proxy_url`        | 探针访问 BaseURL 使用的 HTTP(S) 代理      | 直连     |
| `-url`              | 兼容旧版 Worker 上报地址                 | -      |
| `-collect_interval` | 数据采集间隔（秒），`0` 表示不额外采集并使用单条上报 | `0`    |
| `-interval`         | 数据上报间隔（秒）                    | `60`   |
| `-ct`               | 自定义CT测试节点，支持 `host[:port]` | 默认节点   |
| `-cu`               | 自定义CU测试节点，支持 `host[:port]` | 默认节点   |
| `-cm`               | 自定义CM测试节点，支持 `host[:port]` | 默认节点   |
| `-bd`               | 自定义BD测试节点，支持 `host[:port]` | 默认节点   |
| `-reset_day`        | 流量重置日（1-31）                  | `1`    |
| `-rx_correction`    | 下行流量校正（GB，直接设置当月下行数据）        | -      |
| `-tx_correction`    | 上行流量校正（GB，直接设置当月上行数据）        | -      |

> **注意**：`-collect_interval` 控制本机额外采集频率，`-interval` 控制向 Worker 上报频率。默认 `0` 为兼容模式：不额外采集，只按上报间隔发送单条数据；设置为 `1` 时才会 1 秒采集、按上报间隔批量发送。上报间隔越短，API 调用和数据库写入越多。

</details>

<details>
<summary>升级 Cloudflare Workers</summary>

根据您使用的安装方式，选择对应的升级方法：

### 方式一/方式二：Fork 后通过 GitHub 同步（推荐）

无论你使用 Cloudflare Workers 连接 GitHub 仓库，还是使用 GitHub Action 自动部署，升级方式相同：同步上游仓库即可。

#### 自动同步（推荐）

建议启用自动同步功能，系统会每天自动同步上游仓库的最新代码：

1. 进入你 Fork 的 GitHub 仓库页面
2. 点击 **Actions** 标签
3. 首次使用时，点击 **"I understand my workflows, go ahead and enable them"** 启用 Actions
4. 找到 **Upstream Sync** 工作流，点击进入
5. 点击 **Run workflow** 手动触发一次，确认同步正常工作

启用后，系统每天 UTC 0:00（北京时间 8:00）会自动检测上游仓库是否有新提交，有则自动合并到你的 `main` 分支。

> **注意**：如果同步失败，提示"由于上游仓库的 workflow 文件变更，导致 GitHub 自动暂停了本次自动更新"，请前往仓库页面点击 **Sync Fork** → **Update branch** 手动执行一次同步，然后再次启用 Actions。

#### 手动同步

如果需要立即同步，可以手动操作：

1. 进入你 Fork 的 GitHub 仓库页面
2. 点击 **Sync fork** → **Update branch** 同步上游更新

或者在 **Actions** 标签页中点击 **Upstream Sync** → **Run workflow** 手动触发。

**部署触发方式**：

- **Cloudflare Workers 连接 GitHub 仓库**：同步后 Cloudflare 会自动检测到代码变更并重新部署
- **GitHub Action 自动部署**：同步后 GitHub Actions 会自动触发部署，可在 **Actions** 标签页查看进度

升级到包含“探针网络”配置的版本后，还需要登录管理后台，在“数据库管理”中执行一次 **升级数据库**，为旧 D1 数据库增量添加 `agent_base_url` 和 `agent_proxy_url` 字段。无需在 Cloudflare 侧新增环境变量或绑定。

### 方式三：一键部署

一键部署方式升级较为麻烦，建议重新部署：

1. 访问 [一键部署页面](https://deploy.workers.cloudflare.com/?url=https://github.com/huilang-me/CF-Server-Monitor)
2. 选择已存在的项目进行更新
3. 在 build command 中填入 `npm run build:frontend`
4. 点击部署

> **注意**：一键部署方式不方便同步更新，建议迁移到方式一。

</details>

<details>
<summary>升级探针</summary>

当有新版本部署成功后，可以通过以下命令升级探针，升级过程会自动保留原有配置：

```bash
# Linux
curl -sL https://你的项目.你的子域.workers.dev/install.sh | bash -s install
# Alpine
curl -sL https://你的项目.你的子域.workers.dev/install-alpine.sh | sh -s install
# OpenWrt
curl -sL https://你的项目.你的子域.workers.dev/install-openwrt.sh | sh -s install
# macOS
curl -sL https://你的项目.你的子域.workers.dev/install-mac.sh | sudo bash -s install
# Windows
irm https://你的项目.你的子域.workers.dev/cf-server-monitor.ps1 -OutFile cf-server-monitor.ps1; powershell -ExecutionPolicy Bypass -File .\cf-server-monitor.ps1 install
```

> **V2.7.9 及以上说明**：从 V2.7.8 或更早版本升级后，请重新安装一次探针以启用参数下发能力。之后在后台修改服务器参数会自动下发到探针，无需每次重新安装；受上报间隔和缓存影响，最长约 240 秒才能看到效果。

也可以在服务器编辑配置中启用自动更新。首次启用，或修改探针 BaseURL/代理后，需要重新复制并执行该服务器的安装命令；后续自动更新会沿用本地保存的 BaseURL 和代理。

比如 crontab -e 中添加以下内容，每天凌晨 0 点执行升级：

```bash
# Linux
0 0 * * * curl -sL https://你的项目.你的子域.workers.dev/install.sh | bash -s install
```

</details>

<details>
<summary>卸载探针</summary>

```bash
# Linux
curl -sL https://你的项目.你的子域.workers.dev/install.sh | bash -s uninstall
# Alpine
curl -sL https://你的项目.你的子域.workers.dev/install-alpine.sh | sh -s uninstall
# OpenWrt
curl -sL https://你的项目.你的子域.workers.dev/install-openwrt.sh | sh -s uninstall
# macOS
curl -sL https://你的项目.你的子域.workers.dev/install-mac.sh | sudo bash -s uninstall
# Windows
irm https://你的项目.你的子域.workers.dev/cf-server-monitor.ps1 -OutFile cf-server-monitor.ps1; powershell -ExecutionPolicy Bypass -File .\cf-server-monitor.ps1 uninstall
```
</details>

<details>
<summary>安全增强</summary>

### Turnstile 配置（可选）

如需启用 Turnstile 人机验证，可用于基本拦截恶意攻击，避免额度超出，需在管理后台配置：

1. 登录 [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile)
2. 创建站点，获取 **Site Key** 和 **Secret Key**
3. 在管理后台 → 全局设置中启用 Turnstile 并填入密钥

### JWT 配置（可选）

如需自定义 JWT 密钥：

1. 生成一个至少 32 位的随机字符串作为 JWT Secret
2. 在管理后台 → 全局设置 → 安全设置中填入 JWT Secret
3. 保存后系统将使用自定义密钥进行 token 签名

### CORS 跨域配置（可选）

如需允许特定域名跨域访问 Workers API，可配置允许的来源：

1. 在 Workers & Pages 页面的 **Settings** → **Variables and secrets** 中添加 `CORS_ALLOWED_ORIGINS`
2. 值设置为允许跨域的域名，多个域名用逗号分隔，例如：`https://example.com,https://www.example.com`
3. 不设置此变量或留空时，默认仅允许同源请求

### CSP 内容安全策略配置（可选）

Content Security Policy (CSP) 是一种安全层，用于检测和缓解某些类型的攻击，包括跨站脚本 (XSS) 和数据注入攻击。

项目默认启用 CSP，并采用偏保守的默认策略：除了同源资源和内置必要域名外，第三方静态资源默认会被浏览器拦截。这包括：

- 第三方背景图，例如 `https://cdn.example.com/bg.webp`
- 外部 CSS，例如 `<link rel="stylesheet" href="https://cdn.example.com/theme.css">`
- CSS 里的 `@import`，例如 `@import url('https://cdn.example.com/theme.css')`
- 外部 JS，例如 `<script src="https://cdn.example.com/demo.js"></script>`
- 外部字体、图片、图标等静态文件

如果浏览器控制台出现 `Content Security Policy`、`Refused to load`、`Refused to execute` 等提示，通常不是资源地址失效，而是该第三方域名没有加入 CSP 白名单。

**默认白名单**（已内置）：

- `https://challenges.cloudflare.com` - Cloudflare Turnstile
- `https://static.cloudflareinsights.com` - Cloudflare Analytics
- `https://fonts.googleapis.com` - Google Fonts CSS
- `https://fonts.gstatic.com` - Google Fonts 文件

**后台配置**：

如果需要添加第三方背景图、CSS、JS、字体、图片等资源，可在管理后台 → 外观 设置中配置：

| 字段 | 说明 | 示例 |
|------|------|------|
| CSP 静态文件域名 | 允许加载的第三方静态资源域名 | `https://cdn.jsdelivr.net,https://cdnjs.cloudflare.com` |
| CSP API 域名 | 允许连接的 API 域名 | `https://api.example.com` |

填写规则：

- 只填写域名源（origin），不要填写完整文件路径。例如填写 `https://cdn.jsdelivr.net`，不要填写 `https://cdn.jsdelivr.net/gh/user/repo/style.css`
- 多个域名用英文逗号分隔
- 仅建议填写 `https://` 域名
- 使用同源资源或本地静态文件（例如 `./assets/bg.webp`）不需要额外添加白名单

> **安全提示**：添加第三方 CSS/JS 时，请确保来源安全可靠。CSP 默认拦截第三方资源是为了避免恶意脚本注入、页面被篡改、数据泄露和未知追踪代码。建议优先使用同源资源，或将资源托管在自己可信的仓库/CDN 中；不要把不信任的公共 CDN 域名随意加入白名单。

**GitHub Pages 环境变量配置**：

| 环境变量 | 说明 | 示例 |
|---------|------|------|
| `CSP_STATIC` | 额外的静态文件域名，用于第三方背景图、CSS、JS、字体、图片等 | `https://cdn.jsdelivr.net` |
| `CSP_API` | 额外的 API 域名 | `https://api.example.com` |

> **注意**：`API_BASE` 环境变量会自动添加到 CSP API 白名单中。

### Cloudflare 额度查询（可选）

如需在后台查询 D1 当日读写额度和 Workers 请求量：

1. 在 [Cloudflare Dashboard](https://dash.cloudflare.com/?to=/:account/workers-and-pages)右下角复制当前账户的 **Account ID**
2. 在[API Tokens 页面](https://dash.cloudflare.com/profile/api-tokens)创建具备 **Account Analytics Read** 权限的 Cloudflare API Token
3. 在管理后台 → 全局设置 → Cloudflare 设置中填入 Account ID 和 API Token
4. 保存后点击 **查询 D1 额度** 查看 UTC 当日用量与下次重置时间

</details>

<details>
<summary>通知设置</summary>

## 🔔 通知设置

在管理后台 → 全局设置 → 通知 中配置。支持以下通知方式，通过 Bot Token 字段自动识别平台类型：

### Telegram

1. 创建 Telegram Bot（通过 [@BotFather](https://t.me/BotFather)）
2. 获取 Bot Token，填入 **Bot Token** 字段
3. （通过 [@idbot](https://t.me/idbot)）获取 ID，填入 **Chat ID** 字段

### 飞书

1. 创建飞书群机器人，获取 Webhook URL
2. 将 Webhook URL 填入 **Bot Token** 字段
3. **Chat ID** 留空

### 钉钉

1. 在钉钉群中添加自定义机器人，获取 Webhook URL（包含 `access_token` 参数）
2. 将 Webhook URL 填入 **Bot Token** 字段
3. **Chat ID** 留空

### OneBot (QQ)

1. 部署 OneBot 协议实现（如 go-cqhttp、Lagrange 等），获取 HTTP API 地址
2. 将 API 地址填入 **Bot Token** 字段，格式为 `onebot:http://127.0.0.1:3000/send_private_msg?access_token=xxx`，或 `onebot:http://127.0.0.1:3000/send_group_msg?access_token=xxx`
3. **Chat ID** 填入目标用户 ID（如 `123456`）或群 ID（如 `789012`）

### 企业微信

1. [创建企业微信群机器人](https://open.work.weixin.qq.com/help2/pc/14931) 并配置，获取 Webhook URL
2. 将 Webhook URL 填入 **Bot Token** 字段
3. **Chat ID** 留空

### Bark

1. 获取 Bark 推送链接，比如 `https://api.day.app/xxxxxxx/自定义内容`，删掉中文，保留 `https://api.day.app/xxxxxxx/`
2. 将链接填入 **Bot Token** 字段
3. **Chat ID** 留空
4. 如果是自建 Bark 服务，格式为 `bark:https://example.com/xxxxxxx/`

### Server 酱

1. 注册 [Server 酱](https://sct.ftqq.com/) 获取 SendKey
2. 将 SendKey 填入 **Bot Token** 字段，格式为 `https://sctapi.ftqq.com/你的SendKey.send`
3. **Chat ID** 留空

### WxPusher

1. 注册 [WxPusher](https://wxpusher.zjiecode.com/) 获取 SPT Token
2. 将 SPT Token 填入 **Bot Token** 字段，格式为 `https://wxpusher.zjiecode.com/api/send/message/[SPT_你的Token]/Hello%20WxPusher`
3. **Chat ID** 留空

### Gotify

1. 部署或使用已有的 [Gotify](https://gotify.net/) 服务
2. 在 Gotify 中创建 Application，获取 Token
3. 将推送 URL 填入 **Bot Token** 字段，格式为 `https://你的Gotify地址/message?token=你的Token`
4. **Chat ID** 留空

### 告警类型

| 类型   | 说明                       |
| ---- | ------------------------ |
| 离线告警 | 节点离线达到设置的 2-30 分钟阈值后发送告警，恢复后发送恢复通知 |
| 到期提醒 | 服务器到期前 7 天内每天发送提醒        |

### 测试通知

配置完成后，可点击 **发送测试通知** 按钮验证配置是否正确。测试成功后记得点击 **保存**。

</details>

<details>
<summary>其他设置</summary>

### 前台大盘

访问 `https://你的项目.你的子域.workers.dev/` 查看：

- **条形图视图**：服务器状态概览（含实时网速和本月流量）
- **环形图视图**：服务器资源占用环形展示
- **表格视图**：详细数据列表
- **地图视图**：全球服务器分布
- **过滤器**：按国家筛选服务器

### 服务器详情

点击任意服务器卡片进入详情页：

- 实时 CPU/GPU/内存/磁盘/网络/负载
- 7 天历史趋势图
- 鼠标悬停查看具体时间点的数值
- 国内四线路延迟与丢包率追踪

> **注意**：查看 1 小时以上的历史数据需要登录管理员账户。

### iOS Scriptable 小组件

项目提供了 iOS Scriptable 小组件脚本：[scripts/ios-scriptable-widget.js](scripts/ios-scriptable-widget.js)。

使用方式：

1. 在 iPhone 安装 [Scriptable](https://scriptable.app/)。
2. 将 [scripts/ios-scriptable-widget.js](https://github.com/huilang-me/CF-Server-Monitor/raw/refs/heads/main/scripts/ios-scriptable-widget.js) 内容复制到 Scriptable 新脚本中。
3. 修改脚本顶部的 `CONFIG.baseURL` 为你的站点地址，例如 `https://status.example.com`。
4. 添加 Scriptable 小组件，选择该脚本。
5. 在小组件的 **Parameter** 中填写服务器 ID，例如 `955bd53e-531f-4dc8-8705-dc204000fa98`，也可以写成 `id:955bd53e-531f-4dc8-8705-dc204000fa98`。

说明：

- 如需在桌面上下滑动切换服务器，需要添加多个同尺寸 Scriptable 小组件，每个小组件填写不同的服务器 ID，然后在 iOS 桌面将它们叠成小组件堆叠。
- 小组件会显示服务器在线状态、CPU/RAM/磁盘/流量、实时上下行速率和更新时间。
- 脚本设置了 60 秒后刷新，但 iOS 会根据系统策略决定实际刷新时间。

### 主题切换与自定义

管理后台支持以下自定义功能：

| 功能 | 说明 | 位置 |
|------|------|------|
| 自定义 CSS 主题 | 修改页面样式 | 后台 → 外观 → 自定义脚本 |
| 自定义 `<head>` | 添加外部 CSS/JS、Meta 标签等 | 后台 → 外观 → 自定义 `<head>` |
| 背景图片 | 自定义页面背景 | 后台 → 外观 → 背景图片 |
| CSP 白名单 | 允许加载的第三方资源域名 | 后台 → 外观 → CSP 设置 |

**自定义 `<head>` 使用示例**：

```html
<!-- 引入外部字体 -->
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">

<!-- 通过 CSS @import 引入第三方样式 -->
<style>
@import url('https://cdn.jsdelivr.net/gh/user/repo/theme.css');
</style>

<!-- 自定义 Meta 标签 -->
<meta name="description" content="My Server Monitor">

<!-- 内联样式 -->
<style>body { font-family: 'Inter', sans-serif; }</style>
```

**第三方资源导入说明**：

- 外部 CSS、CSS `@import`、外部 JS、第三方背景图、字体和图片都会受 CSP 限制
- 如果资源来自第三方域名，需要先在后台 → 外观 → CSP 设置 → CSP 静态文件域名中加入对应域名源
- 白名单填写域名源即可，例如资源地址是 `https://cdn.jsdelivr.net/gh/user/repo/theme.css`，只填写 `https://cdn.jsdelivr.net`
- 背景图 URL 如果使用第三方 CDN，也需要把 CDN 域名加入 CSP 静态文件域名
- API 请求或 WebSocket 连接使用第三方域名时，加入 CSP API 域名，而不是 CSP 静态文件域名

> **安全警告**：
> - 添加第三方 CSS/JS 时，请确保来源安全可靠，使用前建议将js源码发给AI完整分析安全后，确认无问题后使用
> - 建议将资源托管在自己的 GitHub 仓库中，通过 CDN 调用
> - 使用不当可能带来 XSS 攻击、数据泄露等严重安全风险
> - 外部资源需要添加到 CSP 白名单中才能正常加载，这是为了安全而默认拦截，不是程序错误

### 主题开发

如需开发自定义主题，请参考 [主题开发文档](theme-develop.md)。

### 拖拽排序

在管理后台的服务器列表中，可以通过拖拽调整服务器的显示顺序

### 服务器隐藏

可以将特定服务器设置为对非登录用户隐藏：

1. 进入管理后台 `/#/admin`
2. 点击服务器行右侧的 **✏️ 编辑** 按钮
3. 勾选 **公开隐藏** 选项
4. 点击 **保存**

### 数据库管理

管理后台提供数据库维护功能，可在 "Database Management" 标签页中找到：

1. **升级数据库**：将数据库结构升级到最新版本，适用于旧版本用户升级
   - 点击「Upgrade Database」按钮
   - 确认升级操作
   - 系统会自动执行数据库升级脚本
2. **清空历史数据**：清空所有历史数据（⚠️ 危险操作）
   - 点击「清空历史数据」按钮
   - 确认操作（此操作将删除所有历史数据）
   - 系统会清空并重新初始化数据库

> **注意**：
>
> - 清空历史数据是不可逆操作，请确保已备份重要数据
> - 升级数据库不会删除现有数据，仅会更新表结构
> - 从旧版本升级到包含 GPU/丢包率监控的新版本后，需要先执行升级数据库，再重新安装或升级探针以采集新字段

</details>

<details>
<summary>定时任务</summary>

系统包含以下定时任务（UTC 时区）：

| 任务   | 触发时间          | 说明                                              |
| ---- | ------------- | ----------------------------------------------- |
| 离线检测 | `*/1 * * * *` | 每分钟检测离线节点并发送告警                                  |
| 合并任务 | `0 * * * *`   | 每小时执行，根据日期判断执行：每月1号数据轮换、每月8号清理旧表、每天12:00服务器到期检测 |

</details>

## 📁 项目结构

<details>
<summary>项目结构</summary>

```
CF-Server-Monitor/
├── public/
│   ├── cf-server-monitor.ps1   # Windows 探针脚本（PowerShell 版，零依赖）
│   ├── install.sh              # 一键安装脚本 - systemd 系统 (Ubuntu/Debian/CentOS)
│   ├── install-alpine.sh       # 一键安装脚本 - OpenRC 系统 (Alpine Linux)
│   ├── install-openwrt.sh      # 一键安装脚本 - procd 系统 (OpenWrt/LEDE)
│   ├── install-mac.sh          # 一键安装脚本 - macOS (Intel / Apple Silicon)
│   ├── favicon.ico             # 站点图标
│   └── logo.svg                # Logo
├── src/
│   ├── index.js                # 后端主入口 - 路由分发 + Durable Object 导出
│   ├── database/
│   │   ├── schema.js             # 数据库初始化、表结构定义
│   │   ├── indexOptimization.js  # 数据库索引优化
│   │   └── updateDatabase.js     # 数据库升级处理
│   ├── durable/
│   │   └── MetricsBroadcaster.js # Durable Object：WebSocket 实时推送广播中心
│   ├── middleware/
│   │   └── auth.js             # 认证中间件
│   ├── handlers/
│   │   ├── admin.js            # 后台管理 API
│   │   ├── dashboard.js        # 前台大盘 API
│   │   ├── frontend.js         # 前端资源服务
│   │   └── update.js           # 数据上报处理 + 广播到 DO
│   ├── services/
│   │   └── notification.js     # 通知服务
│   ├── utils/
│   │   ├── agentConfig.js      # 探针配置下发
│   │   ├── cache.js            # 缓存工具
│   │   ├── common.js           # 通用工具函数
│   │   ├── cors.js             # CORS 处理
│   │   ├── errors.js           # 错误类型与响应封装
│   │   ├── metrics.js          # 指标处理工具
│   │   └── settings.js         # 设置管理
│   └── frontend/               # Vue 3 前端应用
│       ├── App.vue             # 根组件
│       ├── main.js             # 前端入口
│       ├── components/         # Vue 组件
│       │   ├── Footer.vue
│       │   ├── ServerBarCard.vue
│       │   ├── ServerRingCard.vue
│       │   └── TerminalHeader.vue
│       ├── composables/        # 通用组合式函数
│       │   ├── useServerCardData.js
│       │   ├── usePasswordVisibility.js
│       │   └── useTheme.js
│       ├── router/
│       │   └── index.js        # Vue Router 配置
│       ├── styles/             # 样式文件
│       │   ├── light.css
│       │   └── main.css
│       ├── utils/
│       │   ├── api.js          # API 请求封装 + WebSocket 客户端
│       │   ├── config.js       # 前端运行时配置
│       │   ├── constants.js    # 前端常量
│       │   ├── http.js         # HTTP 请求封装
│       │   ├── i18n.js         # 国际化配置
│       │   ├── time.js         # 时间格式化工具
│       │   └── turnstile.js    # Turnstile 共享工具
│       └── views/              # 页面视图
│           ├── admin/          # 管理后台（拆分为独立模块）
│           │   ├── index.vue   # 管理后台主入口
│           │   ├── components/ # 后台子组件
│           │   │   ├── AdminLogin.vue
│           │   │   ├── CopyCommandModal.vue
│           │   │   ├── DatabasePanel.vue
│           │   │   ├── DeleteServerModal.vue
│           │   │   ├── EditServerModal.vue
│           │   │   ├── ServerTable.vue
│           │   │   └── SettingsPanel.vue
│           │   └── composables/
│           │       └── useTurnstile.js
│           ├── Dashboard.vue    # 首页（接入 WebSocket 实时推送）
│           └── ServerDetail.vue # 服务器详情页（历史图表 + 实时推送）
├── scripts/
│   ├── build.js                 # 前端构建脚本
│   ├── build-github-page.js     # GitHub Pages 构建脚本
│   └── ios-scriptable-widget.js # iOS Scriptable 小组件
├── test/
│   ├── README.md               # 测试工具说明
│   ├── agent-config.js         # 探针配置下发测试
│   ├── api-check.js            # 本地 API 检查工具
│   ├── generate-sql.js         # 测试数据生成工具
│   ├── mock-data.sql           # 模拟数据 SQL
│   └── mock-sender.sh          # 模拟数据发送脚本（macOS）
├── index.html
├── jsconfig.json               # JS 配置
├── package.json                # 项目依赖与 npm scripts
├── package-lock.json           # npm 依赖锁定文件
├── vite.config.js              # Vite 配置
├── wrangler.toml               # Wrangler 本地开发配置
├── API.md                      # 后端 API 文档
├── AGENT_CONFIG.md             # 探针配置下发说明
├── develop.md                  # 开发与架构说明
├── theme-develop.md            # 前端主题开发文档
├── todo.md                     # 待办事项列表
└── .github/
    └── workflows/
        ├── deploy.yml             # GitHub Actions 自动部署到 Workers
        ├── deploy-github-page.yml # GitHub Pages 自动部署
        └── sync.yml               # 上游仓库自动同步
```

</details>

## ❓ 常见问题

<details>
<summary>常见问题</summary>

**Q: 部署后返回API_SECRET is required**

如果是部署后丢失`API_SECRET`，请在Workers & Pages页面，点击 **Settings**，删除原有`API_SECRET`（如有），重新添加`API_SECRET`保存触发重新部署，等待部署完成即可。

**Q: 探针安装后不显示数据？**

检查服务器是否能访问该设备配置的探针 BaseURL（以及代理是否可用），在安装命令参数后面加入 ` -debug=1`（目前仅支持 Linux 系统），再查看探针日志：`journalctl -u cf-probe -f`，将错误信息发到 Issue 或 TG 群，调试结束后删掉 `debug=1` 参数重新安装，避免日志过大。日志中的代理密码会被遮罩。

**Q: 如何更换 API_SECRET？**

更新 Cloudflare Workers & Pages 中的 `API_SECRET`，重新部署，并在所有服务器上重新安装探针。如果是GitHub Action 自动部署，需要在 GitHub Secrets 中更新 `API_SECRET`。

**Q: D1 数据库免费额度够用吗？**

Cloudflare D1 免费版提供 5GB 存储和 5M 读取行/日、100K 写入行/日，足以支持服务器监控。

写入行：1台服务器一天占用写入行是1.44k，免费写入额度是100k/天，理论上可用支持60+服务器的监控，如果修改上报频率为120秒可用翻倍。

读取行：1台服务器一天占用读行是8k左右，如果开启站点兼容，大概是1.6k，免费读行是5M/天，非常充裕
主要是前端访问消耗的次数，限制了非登录用户 1 小时以上的查看，只要不被暴力刷额度，绝对够用。如果不放心，可以在后台开启 Turnstile 人机验证，也可以选择仅登录查看。

**Q: D1 数据库免费额度超出扣费吗？**

超出不扣费，只会限制访问，第二天北京时间08:00重置

**Q: 遇到其他异常问题怎么办？**

可以尝试在后台数据库管理中：

- 升级数据库：尝试修复数据库结构问题
- 清空历史数据：清空数据库中的历史数据（⚠️ 注意：此操作将清除所有历史数据，请确保已备份重要信息）

**Q: 忘记密码？**

进入Cloudflare后台，进入D1数据库（server-monitor-db），点击右上角explore data，进入后点击左侧的`setting`表，双击`site_options`右侧的value，可以看到`用户名`和md5加密的`密码`，password修改成`e10adc3949ba59abbe56e057f20f883e`，即默认密码`123456`，右上角点Commit 1 change，弹出的确认框点确认即可。然后访问后台用默认密码登录即可。

**Q: 地区并列显示港澳台和国家**

为了方便用户查看，前端并列显示港澳台和国家，但是旗帜都统一是中国国旗，后端返回的是region字段，这里是输出国家和地区，而不是国家，地图符合中华人民共和国自然资源部标准地图制作（审图号：GS(2023)2767 号）。

</details>

## 📸 界面预览

<details>
<summary>界面预览</summary>

### 深色风格
![image](https://github.com/user-attachments/assets/4e6a5db4-65d3-4d40-91b9-9e46ee140d0d)
![image](https://github.com/user-attachments/assets/c10a1376-3d4c-4a58-8d3b-dc904b30f174)
![image](https://github.com/user-attachments/assets/a9c1aefd-42f7-4805-aa42-bbe9e58aed59)
![image](https://github.com/user-attachments/assets/527bcf04-3124-4f1c-b052-451bccae961d)
![image](https://github.com/user-attachments/assets/ac6f6fbb-b9fb-45cd-93e5-ca08bbad9ecb)
![image](https://github.com/user-attachments/assets/b5436816-54bd-4512-a65c-bf963fd4874c)
![image](https://github.com/user-attachments/assets/ba0d3605-ef64-4be1-884b-9506f20277a8)
![image](https://github.com/user-attachments/assets/197767cc-028b-4ec1-b41f-5cadc2b25629)

### 浅色风格
![image](https://github.com/user-attachments/assets/8d310095-2b93-40f3-b762-323fbe6595f6)
![image](https://github.com/user-attachments/assets/bfa48a70-5379-495f-8599-fc9bf49c4801)
![image](https://github.com/user-attachments/assets/e100d984-3165-4f38-948a-625249b4600a)
![image](https://github.com/user-attachments/assets/7d266ff3-0db7-477b-8029-c76e42298002)

</details>

## 🛠️ 本地开发

<details>
<summary>本地开发步骤</summary>

### 环境要求

- Node.js 18+
- npm 或 pnpm

### 开发步骤

根目录新建 `.env` 文件，添加默认 `API_SECRET`：

```bash
API_SECRET=123456
```

然后执行以下命令进行本地开发：

```bash
# 安装依赖
npm install

# 创建 D1 数据库（首次）
npx wrangler d1 create server-monitor-db

# 启动本地 Worker（默认 https://localhost:8787）
npm run dev

# 单独启动前端 Vite 开发模式（默认 http://localhost:5173）
npm run dev:frontend

# 构建前端生产版本
npm run build:frontend

# 部署到 Cloudflare Workers
npm run deploy
```

定时任务

```
https://localhost:8787/cdn-cgi/handler/scheduled?cron=*/1+*+*+*+* // 每分钟执行一次（离线检测）
https://localhost:8787/cdn-cgi/handler/scheduled?cron=0+*+*+*+* // 每小时执行一次（合并任务）
https://localhost:8787/cdn-cgi/handler/scheduled?cron=0+0+*+*+0 // 每周执行一次（测试使用）
https://localhost:8787/cdn-cgi/handler/scheduled?cron=0+12+*+*+* // 每天12点执行一次（测试使用）
```

### 本地测试数据

支持生成本地测试数据，方便在部署前进行功能测试：

1. 进入 `test` 目录查看详细说明
2. 运行测试数据生成脚本
3. 导入生成的 SQL 数据到本地 D1 数据库
4. 启动本地开发服务器进行测试

```
node test/generate-sql.js
wrangler d1 execute server-monitor-db --file=test/mock-data.sql
```

详细步骤见 [test/README.md](test/README.md)

### API 接口测试

项目提供了 `api-check.js` 接口测试工具，用于验证本地开发环境的 API 接口是否正常工作：

```bash
# 默认配置测试
node test/api-check.js

# 指定参数测试
node test/api-check.js --base-url=http://localhost:8787 --api-secret=123456

# 查看帮助
node test/api-check.js --help
```

**测试覆盖范围：**

- 未登录接口：`/api/config`、`/api/servers`、`/api/server`、`/update` 等
- 登录流程：登录接口验证
- 已登录接口：隐藏服务器访问、历史数据查询等
- 后台管理：服务器增删改查、设置管理等

**选项参数：**

| 参数                 | 说明          | 默认值                     |
| ------------------ | ----------- | ----------------------- |
| `--base-url`       | 本地服务地址      | `http://localhost:8787` |
| `--api-secret`     | API\_SECRET | `123456`                |
| `--admin-user`     | 管理员用户名      | `admin`                 |
| `--admin-password` | 管理员密码       | 使用 API\_SECRET          |
| `--timeout`        | 请求超时时间(ms)  | `10000`                 |

</details>

## 📄 许可证

MIT License

## 🌐 社区

- [Telegram 群组](https://t.me/cfServerMonitor)

## 🙏 致谢

- [CF-Server-Monitor-Pro](https://github.com/a63414262/CF-Server-Monitor-Pro)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Vue 3](https://vuejs.org/)
- [Vite](https://vitejs.dev/)
- [Chart.js](https://www.chartjs.org/)
- [Leaflet](https://leafletjs.com/)
- 感谢 [NodeSeek](https://www.nodeseek.com/post-763025-1)  [LINUX DO](https://linux.do/) 社区的支持与推广
