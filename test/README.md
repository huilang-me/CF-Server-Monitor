# 本地测试工具

本目录包含用于本地测试聚合功能的完整工具，可以无需部署到 Cloudflare 就验证效果。

## 快速开始

### 方式一：使用 Wrangler 本地模式（推荐）

这是最真实的测试方式，体验与生产环境完全一致。

1. **生成模拟数据 SQL**
   ```bash
   cd test
   node generate-sql.js
   ```

2. **初始化数据库结构**
   （如果数据库是空的，先启动一次 dev 来自动创建表）
   ```bash
   # 在项目根目录
   npm run dev
   # 访问一次 http://localhost:8787 会自动初始化表结构
   # 然后按 Ctrl+C 停止
   ```

3. **导入模拟数据**
   ```bash
   # 执行 SQL 导入数据
   wrangler d1 execute server-monitor-db --local --file=test/mock-data.sql
   ```

4. **启动本地开发服务器**
   ```bash
   npm run dev
   ```

5. **访问界面**
   - 首页仪表盘: http://localhost:8787
   - 服务器详情页: http://localhost:8787/?id=s550e8400-e29b-41d4-a716-446655440001
   - 后台管理: http://localhost:8787/admin
   - 手动触发聚合: http://localhost:8787/clear

## 模拟数据说明

### 服务器配置

- **US-East-Fast** (`s550e8400-e29b-41d4-a716-446655440001`)
  - 位置: 美国东部
  - 上报间隔: 60 秒
  - 配置: 4 核 / 32G RAM

- **JP-Tokyo-Stable** (`550e8400-e29b-41d4-a716-446655440002`)
  - 位置: 日本东京
  - 上报间隔: 120 秒
  - 配置: 2 核 / 16G RAM

### 数据特点

- 72 小时完整历史数据
- 指标带有真实波动（白天负载高、晚上负载低）
- 包含完整的 CPU、RAM、网络、Ping 等指标
- 聚合表保持空，方便测试聚合逻辑

## 文件说明

- `generate-sql.js` - 生成 SQL 格式模拟数据的脚本
- `mock-data.sql` - 生成后的 SQL 文件（运行脚本后产生）
- `README.md` - 本文档

## 测试流程建议

1. **测试仪表盘显示** - 访问 http://localhost:8787 查看是否正常显示两台服务器
2. **测试历史图表** - 点击服务器查看详情页，验证历史数据展示
3. **测试聚合功能** - 访问 http://localhost:8787/clear 手动触发聚合，然后检查效果
