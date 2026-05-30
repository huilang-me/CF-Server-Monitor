export function getThemeStyles(sys) {
  return `
    /* =============================================
       Theme 2: Light Terminal (浅色终端)
    ============================================= */
    body.theme2 {
      --bg-primary: #f5f5f0;
      --bg-secondary: #e8e8e0;
      --bg-card: #fafaf5;
      --bg-hover: #f0f0e8;
      --border-color: #d4d4c8;
      --border-active: #b8b8a8;
      --text-primary: #2c2c2c;
      --text-secondary: #5c5c5c;
      --text-muted: #8c8c8c;
      --accent-green: #1a7f5a;
      --accent-blue: #2563eb;
      --accent-purple: #7c3aed;
      --accent-pink: #db2777;
      --accent-yellow: #d97706;
      --accent-red: #dc2626;
      --accent-cyan: #0d9488;
      --input-bg: #ffffff;
      --input-border: #d4d4c8;
    }

    /* 扫描线效果调整 */
    body.theme2::before {
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0, 0, 0, 0.015) 2px,
        rgba(0, 0, 0, 0.015) 4px
      );
    }

    /* =============================================
       Dashboard 页面
    ============================================= */

    /* 终端顶部栏 */
    body.theme2 .terminal-header {
      background: #e8e8e0;
      border-color: #c8c8b8;
      color: #5c5c5c;
    }

    body.theme2 .terminal-title {
      color: #2c2c2c;
    }

    /* 导航区域 */
    body.theme2 .nav-area {
      background: #f0f0e8;
      border-color: #d4d4c8;
    }

    body.theme2 .site-title {
      color: #1a7f5a;
      text-shadow: none;
    }

    body.theme2 .view-toggle {
      background: #ffffff;
      border-color: #d4d4c8;
    }

    body.theme2 .toggle-btn {
      color: #5c5c5c;
    }

    body.theme2 .toggle-btn:hover {
      background: #f0f0e8;
      color: #2c2c2c;
    }

    body.theme2 .toggle-btn.active {
      background: #1a7f5a;
      color: #ffffff;
      border-color: #1a7f5a;
    }

    body.theme2 .admin-link {
      background: #ffffff;
      border-color: #d4d4c8;
      color: #0d9488;
    }

    body.theme2 .admin-link:hover {
      background: #f0f0e8;
      border-color: #b8b8a8;
    }

    /* 过滤器栏 */
    body.theme2 .filter-bar .filter-tag {
      background: #ffffff;
      border-color: #d4d4c8;
      color: #5c5c5c;
    }

    body.theme2 .filter-tag:hover {
      border-color: #b8b8a8;
      color: #2c2c2c;
    }

    body.theme2 .filter-tag.active {
      background: #1a7f5a;
      color: #ffffff;
      border-color: #1a7f5a;
    }

    /* 全局统计 */
    body.theme2 .global-stats {
      background: #d4d4c8;
      border-color: #d4d4c8;
    }

    body.theme2 .stat-item {
      background: #fafaf5;
    }

    body.theme2 .stat-main-value {
      color: #0d9488;
      text-shadow: none;
    }

    /* 分组标题 */
    body.theme2 .group-header {
      color: #1a7f5a;
      border-bottom-color: #d4d4c8;
    }

    /* 服务器卡片 */
    body.theme2 .server-card {
      background: #ffffff;
      border-color: #d4d4c8;
    }

    body.theme2 .server-card:hover {
      border-color: #0d9488;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    }

    body.theme2 .server-name {
      color: #2c2c2c;
    }

    body.theme2 .stat-key {
      color: #5c5c5c;
    }

    body.theme2 .stat-bar-container {
      background: #e8e8e0;
    }

    body.theme2 .stat-value {
      color: #5c5c5c;
    }

    /* Ping面板 */
    body.theme2 .ping-panel {
      background: #f5f5f0;
      border-color: #d4d4c8;
    }

    body.theme2 .ping-label {
      color: #8c8c8c;
    }

    /* 卡片元数据 */
    body.theme2 .card-meta,
    body.theme2 .server-meta {
      color: #5c5c5c;
    }

    /* 徽章保持原有颜色但调整对比度 */
    body.theme2 .badge-bw { background: #2563eb; color: #fff; }
    body.theme2 .badge-tf { background: #1a7f5a; color: #fff; }
    body.theme2 .badge-v4 { background: #7c3aed; color: #fff; }
    body.theme2 .badge-v6 { background: #db2777; color: #fff; }

    /* 分组标签 */
    body.theme2 .group-tag {
      background: rgba(37, 99, 235, 0.08);
      color: #2563eb;
      border-color: rgba(37, 99, 235, 0.2);
    }

    body.theme2 .price-tag {
      background: rgba(217, 119, 6, 0.08);
      color: #d97706;
      border-color: rgba(217, 119, 6, 0.2);
    }

    /* 表格视图 */
    body.theme2 .table-container {
      background: #ffffff;
      border-color: #d4d4c8;
    }

    body.theme2 .terminal-table {
      color: #2c2c2c;
    }

    body.theme2 .terminal-table th {
      background: #f5f5f0;
      color: #5c5c5c;
      border-bottom-color: #d4d4c8;
    }

    body.theme2 .terminal-table td {
      border-bottom-color: #e8e8e0;
    }

    body.theme2 .server-row:hover {
      background: #f5f5f0;
    }

    body.theme2 .os-label {
      color: #5c5c5c;
    }

    body.theme2 .update-time {
      color: #8c8c8c;
    }

    body.theme2 .date-text,
    body.theme2 .spec-text {
      color: #5c5c5c;
    }

    /* 地图视图 */
    body.theme2 .map-wrapper {
      background: #ffffff;
      border-color: #d4d4c8;
    }

    body.theme2 #map-container {
      background: #e8e8e0;
      border-color: #d4d4c8;
    }

    /* 空状态 */
    body.theme2 .empty-state {
      color: #8c8c8c;
    }

    /* =============================================
       Server Detail 页面 (详情页)
    ============================================= */

    /* 主机信息卡 */
    body.theme2 .host-card {
      background: #ffffff;
      border-color: #d4d4c8;
    }

    body.theme2 .host-card-header {
      border-bottom-color: #d4d4c8;
    }

    body.theme2 .host-name {
      color: #1a7f5a;
      text-shadow: none;
    }

    body.theme2 .host-name .prompt {
      color: #8c8c8c;
    }

    /* 系统信息网格 */
    body.theme2 .sysinfo-grid {
      background: #d4d4c8;
    }

    body.theme2 .sysinfo-item {
      background: #fafaf5;
    }

    body.theme2 .sysinfo-item:hover {
      background: #f0f0e8;
    }

    body.theme2 .sysinfo-label {
      color: #8c8c8c;
    }

    body.theme2 .sysinfo-value {
      color: #2c2c2c;
    }

    body.theme2 .sysinfo-value.highlight {
      color: #0d9488;
    }

    /* 图表卡片 */
    body.theme2 .chart-card {
      background: #ffffff;
      border-color: #d4d4c8;
    }

    body.theme2 .chart-card:hover {
      border-color: #b8b8a8;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
    }

    body.theme2 .chart-card-header {
      background: #f5f5f0;
      border-bottom-color: #d4d4c8;
    }

    body.theme2 .chart-title {
      color: #2c2c2c;
    }

    body.theme2 .chart-title-icon {
      color: #0d9488;
    }

    body.theme2 .chart-current-value {
      color: #1a7f5a;
      text-shadow: none;
    }

    body.theme2 .chart-subtitle {
      color: #8c8c8c;
    }

    /* 网络指示器 */
    body.theme2 .net-down {
      color: #1a7f5a;
    }

    body.theme2 .net-up {
      color: #2563eb;
    }

    /* 底部状态栏 */
    body.theme2 .status-bar {
      background: #ffffff;
      border-color: #d4d4c8;
      color: #8c8c8c;
    }

    body.theme2 .status-bar-dot {
      background: #1a7f5a;
    }

    /* =============================================
       Admin 页面 (管理后台) - 完整补充
    ============================================= */

    /* 主面板 */
    body.theme2 .main-panel {
      background: #f0f0e8;
      border-color: #d4d4c8;
    }

    body.theme2 .panel-header {
      /* 继承主面板背景 */
    }

    body.theme2 .panel-title {
      color: #1a7f5a;
      text-shadow: none;
    }

    body.theme2 .panel-title .prompt {
      color: #8c8c8c;
    }

    /* 统计卡片网格 */
    body.theme2 .stats-grid {
      background: #d4d4c8;
      border-color: #d4d4c8;
    }

    body.theme2 .stat-card {
      background: #fafaf5;
    }

    body.theme2 .stat-value {
      color: #0d9488;
      text-shadow: none;
    }

    body.theme2 .stat-label {
      color: #8c8c8c;
    }

    /* 按钮 */
    body.theme2 .btn {
      background: #ffffff;
      border-color: #d4d4c8;
      color: #2c2c2c;
    }

    body.theme2 .btn:hover {
      background: #f5f5f0;
      border-color: #b8b8a8;
    }

    body.theme2 .btn-primary {
      background: #1a7f5a;
      color: #ffffff;
      border-color: #1a7f5a;
    }

    body.theme2 .btn-primary:hover {
      background: #166b4a;
    }

    body.theme2 .btn-icon {
      /* 继承按钮样式 */
    }

    body.theme2 .btn-green:hover { 
      border-color: #1a7f5a; 
      color: #1a7f5a; 
    }

    body.theme2 .btn-blue:hover { 
      border-color: #2563eb; 
      color: #2563eb; 
    }

    body.theme2 .btn-red:hover { 
      border-color: #dc2626; 
      color: #dc2626; 
    }

    /* 标签切换 */
    body.theme2 .tabs {
      background: #ffffff;
      border-color: #d4d4c8;
    }

    body.theme2 .tab-btn {
      color: #5c5c5c;
    }

    body.theme2 .tab-btn:hover {
      background: #f0f0e8;
      color: #2c2c2c;
    }

    body.theme2 .tab-btn.active {
      background: #1a7f5a;
      color: #ffffff;
    }

    /* 工具栏 */
    body.theme2 .toolbar-input {
      background: #ffffff;
      border-color: #d4d4c8;
      color: #2c2c2c;
    }

    body.theme2 .toolbar-input:focus {
      border-color: #0d9488;
      box-shadow: 0 0 0 2px rgba(13, 148, 136, 0.1);
    }

    body.theme2 .toolbar-input::placeholder {
      color: #b8b8a8;
    }

    body.theme2 .toolbar-select {
      background: #ffffff;
      border-color: #d4d4c8;
      color: #2c2c2c;
    }

    body.theme2 .toolbar-select:focus {
      border-color: #0d9488;
    }

    /* 提示框 */
    body.theme2 .alert {
      /* 基础样式 */
    }

    body.theme2 .alert-info {
      background: rgba(13, 148, 136, 0.05);
      border-color: rgba(13, 148, 136, 0.2);
      color: #0d9488;
    }

    body.theme2 .alert-icon {
      /* 继承提示框颜色 */
    }

    /* 表格包装器 */
    body.theme2 .table-wrapper {
      border-color: #d4d4c8;
    }

    /* 命令行输入包装器 */
    body.theme2 .cmd-input-wrapper {
      background: #f5f5f0;
      border-color: #d4d4c8;
    }

    body.theme2 .cmd-prompt {
      color: #1a7f5a;
    }

    body.theme2 .cmd-input {
      color: #5c5c5c;
    }

    body.theme2 .cmd-input:focus {
      /* 保持输入框样式 */
    }

    /* 批量操作按钮区域 */
    body.theme2 .batch-actions {
      /* 间距样式保持不变 */
    }

    /* 设置面板 */
    body.theme2 .settings-grid {
      /* 网格布局保持不变 */
    }

    body.theme2 .settings-section {
      background: #fafaf5;
      border-color: #d4d4c8;
    }

    body.theme2 .section-title {
      color: #1a7f5a;
    }

    /* 表单元素 */
    body.theme2 .form-group {
      /* 间距保持不变 */
    }

    body.theme2 .form-label {
      color: #5c5c5c;
    }

    body.theme2 .form-label .required {
      color: #dc2626;
    }

    body.theme2 .form-input {
      background: #ffffff;
      border-color: #d4d4c8;
      color: #2c2c2c;
    }

    body.theme2 .form-input:focus {
      border-color: #0d9488;
      box-shadow: 0 0 0 2px rgba(13, 148, 136, 0.1);
    }

    body.theme2 .form-input::placeholder {
      color: #b8b8a8;
    }

    body.theme2 .form-select {
      background: #ffffff;
      border-color: #d4d4c8;
      color: #2c2c2c;
    }

    body.theme2 .form-select:focus {
      border-color: #0d9488;
    }

    body.theme2 .form-textarea {
      background: #ffffff;
      border-color: #d4d4c8;
      color: #2c2c2c;
    }

    body.theme2 .form-textarea:focus {
      border-color: #0d9488;
      box-shadow: 0 0 0 2px rgba(13, 148, 136, 0.1);
    }

    /* 复选框项 */
    body.theme2 .checkbox-item {
      background: #ffffff;
      border-color: #d4d4c8;
    }

    body.theme2 .checkbox-item:hover {
      background: #f5f5f0;
      border-color: #b8b8a8;
    }

    body.theme2 .checkbox-item label {
      color: #2c2c2c;
    }

    body.theme2 .checkbox-item .checkbox-badge {
      background: rgba(26, 127, 90, 0.1);
      color: #1a7f5a;
    }

    body.theme2 .highlight-box {
      background: #fffbeb;
      border-color: #fde68a !important;
    }

    /* 文件上传按钮包装器 */
    body.theme2 .upload-btn-wrapper {
      /* 保持布局 */
    }

    body.theme2 .bg-preview {
      border-color: #d4d4c8;
    }

    /* 模态框 */
    body.theme2 .modal-overlay {
      background: rgba(0, 0, 0, 0.3);
    }

    body.theme2 .modal-dialog {
      background: #ffffff;
      border-color: #d4d4c8;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
    }

    body.theme2 .modal-header {
      border-bottom-color: #d4d4c8;
    }

    body.theme2 .modal-title {
      color: #1a7f5a;
    }

    body.theme2 .modal-close {
      color: #8c8c8c;
    }

    body.theme2 .modal-close:hover {
      background: #f5f5f0;
      color: #dc2626;
    }

    body.theme2 .modal-footer {
      border-top-color: #d4d4c8;
    }

    /* 操作按钮组 */
    body.theme2 .action-group {
      /* 保持布局 */
    }

    body.theme2 .action-btns {
      /* 保持布局 */
    }

    /* 表格中的状态标签 */
    body.theme2 .status-label {
      border-color: inherit;
    }

    /* 返回按钮 */
    body.theme2 .back-btn {
      background: #ffffff;
      border-color: #d4d4c8;
      color: #0d9488;
    }

    body.theme2 .back-btn:hover {
      background: #f0f0e8;
      border-color: #b8b8a8;
      color: #1a7f5a;
    }

    /* 时间选择器 */
    body.theme2 .time-selector {
      background: #ffffff;
      border-color: #d4d4c8;
    }

    body.theme2 .time-btn {
      color: #5c5c5c;
    }

    body.theme2 .time-btn:hover {
      background: #f0f0e8;
      color: #2c2c2c;
    }

    body.theme2 .time-btn.active {
      background: #1a7f5a;
      color: #ffffff;
    }

    /* 状态徽章 */
    body.theme2 .status-badge.online {
      background: rgba(26, 127, 90, 0.08);
      color: #1a7f5a;
      border-color: rgba(26, 127, 90, 0.2);
    }

    body.theme2 .status-badge.offline {
      background: rgba(220, 38, 38, 0.08);
      color: #dc2626;
      border-color: rgba(220, 38, 38, 0.2);
    }

    /* 脉冲点 */
    body.theme2 .pulse-dot.online {
      background: #1a7f5a;
      box-shadow: 0 0 6px rgba(26, 127, 90, 0.3);
    }

    body.theme2 .pulse-dot.offline {
      background: #dc2626;
      box-shadow: 0 0 6px rgba(220, 38, 38, 0.3);
    }

    /* 状态指示器 */
    body.theme2 .status-indicator {
      /* 保持原有样式，颜色由内联style控制 */
    }

    /* 网络状态标签 */
    body.theme2 .network-stats {
      /* 保持布局 */
    }

    /* 统计条填充 */
    body.theme2 .stat-bar-fill {
      /* 保持原有样式，颜色由内联style控制 */
    }

    /* 滚动条 */
    body.theme2 ::-webkit-scrollbar-track {
      background: #f5f5f0;
    }

    body.theme2 ::-webkit-scrollbar-thumb {
      background: #d4d4c8;
    }

    body.theme2 ::-webkit-scrollbar-thumb:hover {
      background: #b8b8a8;
    }

    /* 表格统计容器 */
    body.theme2 .table-stat {
      /* 保持布局 */
    }

    /* 响应式保持 */
    @media (max-width: 768px) {
      body.theme2 .settings-grid { 
        grid-template-columns: 1fr; 
      }
      
      body.theme2 .stats-grid { 
        grid-template-columns: repeat(2, 1fr); 
      }
      
      body.theme2 .toolbar { 
        flex-direction: column; 
      }
      
      body.theme2 .toolbar-input { 
        width: 100%; 
      }
    }

    /* 自定义背景图片（如果设置） */
    ${sys.custom_bg ? `
      body.theme2 {
        background: url('${sys.custom_bg}') no-repeat center center fixed !important;
        background-size: cover !important;
      }
      body.theme2 .server-card,
      body.theme2 .host-card,
      body.theme2 .chart-card,
      body.theme2 .global-stats,
      body.theme2 .main-panel,
      body.theme2 .table-container,
      body.theme2 .settings-section,
      body.theme2 .modal-dialog {
        background: rgba(255, 255, 255, 0.85) !important;
        backdrop-filter: blur(12px) !important;
      }
      body.theme2 .terminal-header,
      body.theme2 .nav-area,
      body.theme2 .chart-card-header,
      body.theme2 .terminal-table th {
        background: rgba(240, 240, 232, 0.85) !important;
        backdrop-filter: blur(12px) !important;
      }
      body.theme2 .stat-item,
      body.theme2 .sysinfo-item,
      body.theme2 .stat-card {
        background: rgba(250, 250, 245, 0.85) !important;
        backdrop-filter: blur(12px) !important;
      }
      body.theme2 .table-stat,
      body.theme2 .action-group,
      body.theme2 .checkbox-item {
        background: transparent !important;
      }
    ` : ''}

    /* 自定义CSS主题（theme6） */
    ${sys.theme === 'theme6' ? (sys.custom_css || '') : ''}
  `;
}

export function getFooterHtml() {
  return `
  <div style="text-align: center; margin-top: 40px; padding-bottom: 20px; font-size: 13px; color: inherit; opacity: 0.8;">
        <span style="font-weight: 600;">V1.3</span> | Powered by <a href="https://github.com/buxingjun/CF-Server-Monitor" target="_blank" style="color: #3b82f6; text-decoration: none; font-weight: 600;">CF-Server-Monitor</a>
      </div>
  `;
}
