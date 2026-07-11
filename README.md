# [CF-Server-Monitor](https://github.com/huilang-me/CF-Server-Monitor)

一个基于 Cloudflare Workers + D1 + Durable Objects 的多服务器监控探针系统，支持实时监控、历史数据查看、延迟追踪、地图展示等功能。兼容主流Linux系统，Alpine Linux，OpenWrt，Windows系统。**演示地址**：<https://demo.huilang.me/>

**当前版本：V2.7.9 Beta**

> [!IMPORTANT]
> **🚨 紧急安全/性能更新 (v2.7.8)**
> 
> 本次版本修复了 **月度任务导致数据表索引丢失** 的严重 Bug。该问题影响 **v2.7.0 ~ v2.7.7** 所有版本。
> 
> ⚠️ **潜在影响**：此 Bug 会严重增加 D1 读行消耗，**可能导致免费额度超限，造成服务不可用**。
> 
> **👉 请所有用户务必立即升级！**

<details>
<summary>更新记录</summary>

- V2.7.9 Beta 修改数据库结构，减少一半D1写入消耗，理论上支持60+服务器监控，其他bug修复
- V2.7.8 修复月度任务导致数据表索引丢失的严重 Bug
- V2.7.7 添加GitHub Page部署支持，添加飞书，Bark通知支持
- V2.7.6 添加多站点支持包括验证码登录等，添加Windows PowerShell无依赖安装脚本，一些安全优化
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
- 📈 **历史图表**：支持7天历史数据查看
- 🌍 **全球地图**：可视化展示服务器分布
- 🔔 **离线告警**：支持 Telegram、企业微信 / 飞书 / Bark 通知
- 📱 **响应式**：支持桌面端和移动端
- 🔄 **自动部署**：GitHub Actions 一键部署
- 🗺️ **网络质量追踪**：国内电信/联通/移动/字节延迟与丢包率监测
- 🔒 **服务器隐藏**：可设置特定服务器对非登录用户隐藏
- ↕️ **拖拽排序**：后台拖拽调整服务器显示顺序
- 🌐 **双语支持**：支持中文和英文界面自由切换
- 🧪 **本地测试**：支持本地模拟数据生成，方便开发和测试
- 🔐 **Turnstile 验证**：集成 Cloudflare Turnstile 人机验证，增强 API 安全性
- 🔑 **JWT 认证**：登录系统采用 JWT token 认证，支持自定义密钥
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
7. Deploy command 填写：`npx wrangler deploy --keep-vars`
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

### 第五步：部署

#### 方式一：自动部署

推送代码到 `main` 分支即可自动部署：

```bash
# 克隆你 Fork 的仓库
git clone https://github.com/你的用户名/CF-Server-Monitor.git
cd CF-Server-Monitor

# 可选：修改配置后提交
git add .
git commit -m "Initial setup"
git push origin main
```

推送后，GitHub Actions 会自动部署。在仓库的 **Actions** 标签页可查看部署进度。

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
https://你的项目名.你的子域.workers.dev/#admin
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

### Linux系统

Ubuntu / Debian / CentOS / RHEL / Fedora / Rocky / AlmaLinux 系统

```bash
curl -sL https://你的项目.你的子域.workers.dev/install.sh | bash -s install -id=<SERVER_ID> -secret=<SECRET> -url=<WORKER_URL> [-collect_interval=0] [-interval=60] [-ping=http] [-ct=xxx] [-cu=xxx] [-cm=xxx] [-bd=xxx] [-reset_day=1] [-rx_correction=N] [-tx_correction=N]
```

Alpine 系统

```bash
curl -sL https://你的项目.你的子域.workers.dev/install-alpine.sh | sh -s install -id=<SERVER_ID> -secret=<SECRET> -url=<WORKER_URL> [-collect_interval=0] [-interval=60] [-ping=http] [-ct=xxx] [-cu=xxx] [-cm=xxx] [-bd=xxx] [-reset_day=1] [-rx_correction=N] [-tx_correction=N]
```

OpenWrt / LEDE / ImmortalWrt 系统

```bash
curl -sL https://你的项目.你的子域.workers.dev/install-openwrt.sh | sh -s install -id=<SERVER_ID> -secret=<SECRET> -url=<WORKER_URL> [-collect_interval=0] [-interval=60] [-ping=http] [-ct=xxx] [-cu=xxx] [-cm=xxx] [-bd=xxx] [-reset_day=1] [-rx_correction=N] [-tx_correction=N]
```

### Windows 系统安装

```powershell
irm https://你的项目.你的子域.workers.dev/cf-server-monitor.ps1 -OutFile cf-server-monitor.ps1; powershell -ExecutionPolicy Bypass -File .\cf-server-monitor.ps1 install -Id <SERVER_ID> -Secret <SECRET> -Url <WORKER_URL> [-ReportInterval=60] [-PingType=tcp] [-CtNode=xxx] [-CuNode=xxx] [-CmNode=xxx] [-BdNode=xxx] [-ResetDay=1]
```

**其他命令**

```powershell
# 停止探针
powershell -ExecutionPolicy Bypass -File .\cf-server-monitor.ps1 stop

# 查看状态
powershell -ExecutionPolicy Bypass -File .\cf-server-monitor.ps1 status

# 卸载服务
powershell -ExecutionPolicy Bypass -File .\cf-server-monitor.ps1 uninstall
```
----

### 参数说明

| 参数               | 说明                      | 默认值    |
| ---------------- | ----------------------- | ------ |
| `-id`            | 服务器唯一标识符（必填）            | -      |
| `-secret`        | API 认证密钥（必填）            | -      |
| `-url`           | Worker 上报地址（必填）         | -      |
| `-collect_interval` | 数据采集间隔（秒），`0` 表示不额外采集并使用单条上报 | `0`    |
| `-interval`      | 数据上报间隔（秒）               | `60`   |
| `-ping`          | Ping 检测类型（`http`/`tcp`） | `http` |
| `-ct`            | 自定义CT测试节点               | 默认节点   |
| `-cu`            | 自定义CU测试节点               | 默认节点   |
| `-cm`            | 自定义CM测试节点               | 默认节点   |
| `-bd`            | 自定义BD测试节点               | 默认节点   |
| `-reset_day`     | 流量重置日（1-31）             | `1`    |
| `-rx_correction` | 下行流量校正（GB，直接设置当月下行数据）   | -      |
| `-tx_correction` | 上行流量校正（GB，直接设置当月上行数据）   | -      |

> **注意**：`-collect_interval` 控制本机额外采集频率，`-interval` 控制向 Worker 上报频率。默认 `0` 为兼容模式：不额外采集，只按上报间隔发送单条数据；设置为 `1` 时才会 1 秒采集、按上报间隔批量发送。上报间隔越短，API 调用和数据库写入越多。

</details>

<details>
<summary>升级 Cloudflare Workers</summary>

根据您使用的安装方式，选择对应的升级方法：

### 方式一：Cloudflare Workers 连接 GitHub 仓库

由于 Cloudflare Workers 直接连接 GitHub 仓库，升级非常简单：

1. 进入您 Fork 的 GitHub 仓库页面
2. 点击 **Sync fork** → **Update branch** 同步上游更新
3. Cloudflare Workers 会自动检测到代码变更并重新部署

或者使用命令行同步：

```bash
# 进入本地仓库目录
cd CF-Server-Monitor

# 添加上游仓库（首次需要）
git remote add upstream https://github.com/huilang-me/CF-Server-Monitor.git

# 拉取上游更新
git fetch upstream

# 合并到本地 main 分支
git checkout main
git merge upstream/main

# 推送到您的仓库
git push origin main
```

推送后 Cloudflare Workers 会自动部署最新版本。

### 方式二：GitHub Action 自动部署

与方式一类似，同步上游仓库后推送即可：

1. 同步上游仓库（参考方式一的步骤）
2. 推送代码后 GitHub Actions 会自动触发部署
3. 在仓库的 **Actions** 标签页查看部署进度

也可以手动触发部署：

1. 进入 GitHub 仓库 → **Actions** → **Deploy to Cloudflare Workers**
2. 点击 **Run workflow** → 选择分支 → **Run workflow**

### 方式三：一键部署

一键部署方式升级较为麻烦，建议重新部署：

1. 访问 [一键部署页面](https://deploy.workers.cloudflare.com/?url=https://github.com/huilang-me/CF-Server-Monitor)
2. 选择已存在的项目进行更新
3. 在 build command 中填入 `npm run build:frontend`
4. 点击部署

> **注意**：一键部署方式不方便同步更新，建议迁移到方式一或方式二。

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
```
为了安全，没有提供自动升级功能，如有需要自行将升级脚本加入服务器定时任务。

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
```

Windows 系统（PowerShell 版）

```powershell
powershell -ExecutionPolicy Bypass -File .\cf-server-monitor.ps1 uninstall
```

Windows 系统（Python 版）

启动cf-server-monitor.pyw后，GUI中关闭自启动（如已开启）。点删除，再删除这个文件即可

</details>

<details>
<summary>安全增强</summary>

### Turnstile 配置（可选）

如需启用 Turnstile 人机验证，可用基本拦截恶意攻击避免额度超出，需在管理后台配置：

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

### 企业微信

1. [创建企业微信群机器人](https://open.work.weixin.qq.com/help2/pc/14931) 并配置，获取 Webhook URL
2. 将 Webhook URL 填入 **Bot Token** 字段
3. **Chat ID** 留空

### Bark

1. 获取 Bark 推送链接，比如 `https://api.day.app/xxxxxxx/自定义内容`，删掉中文，保留 `https://api.day.app/xxxxxxx/`
2. 将链接填入 **Bot Token** 字段
3. **Chat ID** 留空

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

| 类型 | 说明 |
| --- | --- |
| 离线告警 | 节点离线 5 分钟后发送告警，恢复后发送恢复通知 |
| 到期提醒 | 服务器到期前 7 天内每天发送提醒 |

### 测试通知

配置完成后，可点击 **发送测试通知** 按钮验证配置是否正确。测试成功后记得点击 **保存**。

</details>

<details>
<summary>其他设置</summary>

### 前台大盘

访问 `https://你的项目.你的子域.workers.dev/` 查看：

- **卡片视图**：服务器状态概览（含实时网速和本月流量）
- **表格视图**：详细数据列表
- **地图视图**：全球服务器分布
- **过滤器**：按国家筛选服务器

### 服务器详情

点击任意服务器卡片进入详情页：

- 实时 CPU/GPU/内存/磁盘/网络/负载
- 7天历史趋势图
- 鼠标悬停查看具体时间点的数值
- 国内四线路延迟与丢包率追踪

> **注意**：查看1小时以上的历史数据需要登录管理员账户。

### 主题切换

管理后台支持自定义 CSS主题

### 主题开发

如需开发自定义主题，请参考 [主题开发文档](theme-develop.md)。

### 拖拽排序

在管理后台的服务器列表中，可以通过拖拽调整服务器的显示顺序

### 服务器隐藏

可以将特定服务器设置为对非登录用户隐藏：

1. 进入管理后台 `/#/admin`
2. 点击服务器行右侧的 **✏️ 编辑** 按钮
3. 勾选 **Hide from Public** 选项
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
> - 重建数据库是不可逆操作，请确保已备份重要数据
> - 升级数据库不会删除现有数据，仅会更新表结构
> - 从旧版本升级到包含 GPU/丢包率监控的新版本后，需要先执行升级数据库，再重新安装或升级探针以采集新字段

</details>

<details>
<summary>定时任务</summary>

系统包含以下定时任务（UTC 时区）：

| 任务   | 触发时间          | 说明                                    |
| ---- | ------------- | ------------------------------------- |
| 离线检测 | `*/1 * * * *` | 每分钟检测离线节点并发送告警 |
| 合并任务 | `0 * * * *`   | 每小时执行，根据日期判断执行：每月1号数据轮换、每月8号清理旧表、每天12:00服务器到期检测 |

</details>

## 📁 项目结构

<details>
<summary>项目结构</summary>

```
CF-Server-Monitor/
├── public/
│   ├── cf-server-monitor.ps1   # Windows 探针脚本（PowerShell 版，零依赖）
│   ├── cf-server-monitor.pyw   # Windows 探针脚本（Python 版，带 GUI）
│   ├── install.sh              # 一键安装脚本 - systemd 系统 (Ubuntu/Debian/CentOS)
│   ├── install-alpine.sh       # 一键安装脚本 - OpenRC 系统 (Alpine Linux)
│   ├── install-openwrt.sh      # 一键安装脚本 - procd 系统 (OpenWrt/LEDE)
│   └── logo.svg                # Logo
├── src/
│   ├── index.js                # 后端主入口 - 路由分发 + Durable Object 导出
│   ├── database/
│   │   ├── schema.js           # 数据库初始化、历史数据存储
│   │   └── updateDatabase.js   # 数据库升级处理
│   ├── durable/
│   │   └── MetricsBroadcaster.js  # Durable Object：WebSocket 实时推送广播中心
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
│   │   ├── cache.js            # 缓存工具
│   │   └── settings.js         # 设置管理
│   └── frontend/               # Vue 3 前端应用
│       ├── components/         # Vue 组件
│       │   ├── Footer.vue
│       │   ├── ServerCard.vue
│       │   └── TerminalHeader.vue
│       ├── views/              # 页面视图
│       │   ├── Admin.vue
│       │   ├── Dashboard.vue    # 首页（接入 WebSocket 实时推送）
│       │   └── ServerDetail.vue # 详情页（接入 WebSocket 实时推送）
│       ├── router/
│       │   └── index.js        # Vue Router 配置
│       ├── utils/
│       │   ├── api.js          # API 请求封装 + WebSocket 客户端
│       │   └── i18n.js         # 国际化配置
│       ├── styles/             # 样式文件
│       │   ├── light.css
│       │   └── main.css
│       ├── App.vue             # 根组件
│       └── main.js             # 前端入口
├── scripts/
│   └── build.js                # 前端构建脚本
├── test/
│   ├── README.md               # 测试工具说明
│   └── generate-sql.js         # 测试数据生成工具
│   ├── mock-sender.sh          # 模拟数据发送脚本（macOS）
├── index.html
├── jsconfig.json               # JS 配置
├── package.json
├── vite.config.js              # Vite 配置
├── wrangler.toml               # 本地测试 wrangler 配置
├── API.md                      # 后端 API 文档
├── theme-develop.md            # 前端主题开发文档
├── todo.md                     # 待办事项列表
└── .github/
    └── workflows/
        └── deploy.yml          # GitHub Actions 自动部署
```

</details>

## ❓ 常见问题

<details>
<summary>常见问题</summary>

**Q: 部署后返回API\_SECRET is required**

如果是部署后丢失API\_SECRET，请在Workers & Pages页面，点击 **Settings**，修改Build configuration的Deploy command为：`npx wrangler deploy --keep-vars`，重新设置API\_SECRET，下次部署会继续保留。旧key可用通过`cat /etc/systemd/system/cf-probe.service`或者`cat /etc/init.d/cf-probe`获取。

如果是GitHub Action 自动部署，确保在 GitHub Secrets 中设置了 API\_SECRET 密钥。

如果是一键部署，确保在Cloudflare Workers & Pages 中设置了 API\_SECRET 密钥。

**Q: 探针安装后不显示数据？**

检查服务器是否能访问 Worker URL，在安装命令参数后面加入` -debug=1`（目前仅支持linux系统），再查看探针日志：`journalctl -u cf-probe -f`，将错误信息发到Issue或者TG群，调试结束后删掉debug=1参数重新安装，避免日志过大。

**Q: 如何更换 API\_SECRET？**

更新 Cloudflare Workers & Pages 中的 `API_SECRET`，重新部署，并在所有服务器上重新安装探针。如果是GitHub Action 自动部署，需要在 GitHub Secrets 中更新 `API_SECRET`。

**Q: D1 数据库免费额度够用吗？**

Cloudflare D1 免费版提供 5GB 存储和 5M 读取行/日、100K 写入行/日，足以支持服务器监控。

写入行：1台服务器一天占用写入行是1.44k，免费写入额度是100k/天，理论上可用支持60+服务器的监控，如果修改上报频率为120秒可用翻倍。

读取行：1台服务器一天占用读行是8k左右，如果开启站点兼容，大概是1.6k，免费读行是5M/天，非常充裕
主要是前端访问消耗的次数，限制了非登录用户1小时以上的查看，只要不被暴力刷额度，绝对够用，如果不放心，可用在后台开启Turnstile人机验证，或者也可以选择仅登录查看

**Q: D1 数据库免费额度超出扣费吗？**

超出不扣费，只会限制访问，第二天北京时间08:00重置

**Q: 遇到其他异常问题怎么办？**

可以尝试在后台数据库管理中：

- 升级数据库：尝试修复数据库结构问题
- 重置数据库：清空并重建数据库（⚠️ 注意：此操作将清除所有数据，请确保已备份重要信息）

**Q: 忘记密码？**

进入Cloudflare后台，进入D1数据库（server-monitor-db），点击右上角explore data，进入后点击左侧的`setting`表，双击`site_options`右侧的value，可以看到`用户名`和md5加密的`密码`，password修改成`e10adc3949ba59abbe56e057f20f883e`，即默认密码`123456`，右上角点Commit 1 change，弹出的确认框点确认即可。然后访问后台用默认密码登录即可。

**Q: 地区并列显示港澳台和国家**

为了方便用户查看，前端并列显示港澳台和国家，但是旗帜都统一是中国国旗，后端返回的是region字段，这里是输出国家和地区，而不是国家，地图符合中华人民共和国自然资源部标准地图制作（审图号：GS(2023)2767 号）。

</details>

## 📸 界面预览

<details>
<summary>界面预览</summary>

![image](https://github.com/user-attachments/assets/0527f847-4631-47ad-8315-3f80ebba42d2)
![image](https://github.com/user-attachments/assets/a9c1aefd-42f7-4805-aa42-bbe9e58aed59)
![image](https://github.com/user-attachments/assets/527bcf04-3124-4f1c-b052-451bccae961d)
![image](https://github.com/user-attachments/assets/ac6f6fbb-b9fb-45cd-93e5-ca08bbad9ecb)
![image](https://github.com/user-attachments/assets/b5436816-54bd-4512-a65c-bf963fd4874c)
![image](https://github.com/user-attachments/assets/ba0d3605-ef64-4be1-884b-9506f20277a8)
![image](https://github.com/user-attachments/assets/197767cc-028b-4ec1-b41f-5cadc2b25629)

浅色风格
![image](https://github.com/user-attachments/assets/3a7f3204-0a68-4f59-9822-f7f1b5479822)
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

根目录新建 `.env` 文件，添加环境变量默认API\_SECRET：

```bash
API_SECRET = "123456"
```

然后执行以下命令进行本地开发：

```bash
# 安装依赖
npm install

# 创建 D1 数据库（首次）
npx wrangler d1 create server-monitor-db

# 前端开发模式（热重载）
npm run dev

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
- 感谢 [LINUX DO](https://linux.do/) [NodeSeek](https://www.nodeseek.com/post-763025-1) 社区的支持与推广

