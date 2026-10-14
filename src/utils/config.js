// 当前 Worker 版本：/api/config 返回给前端与主题，用于页脚和升级提示。
export const CURRENT_VERSION = '2.8.7 Beta1';

// 站点设置默认值与缓存策略。
export const DEFAULT_SITE_TITLE = 'Cloudflare Server Monitor';
export const SITE_SETTINGS_CACHE_TTL_MS = 120 * 1000;
export const JWT_SECRET_MIN_LENGTH = 32;

// 首页三网延迟/丢包小窗口：影响 /api/servers 的 servers[].ping/loss 抽样，并通过 /api/config 暴露给主题。
export const DASHBOARD_LATENCY_WINDOW_POINTS = 20;
export const DASHBOARD_LATENCY_WINDOW_HOURS = 2;
export const DASHBOARD_LATENCY_WINDOW_CACHE_TTL_MS = 5 * 60 * 1000;
export const DASHBOARD_LATENCY_WINDOW_CACHE_MAX_SERVERS = 1000;
export const DASHBOARD_LATENCY_WINDOW_QUERY_CONCURRENCY = 20;

// 首页从 Durable Object 批量读取最新上报回放时，每次请求携带的服务器 ID 数量。
export const DASHBOARD_LATEST_REPORT_ID_CHUNK_SIZE = 500;

// 最新上报回放缓存：Worker isolate 与 Durable Object 使用同一组保留时长/容量。
export const LATEST_REPORT_CACHE_TTL_MS = 5 * 60 * 1000;
export const LATEST_REPORT_CACHE_MAX_SERVERS = 1000;

// /update 上报后的实时广播批处理参数；资源告警无前端订阅时使用较长窗口降低 DO 请求。
export const UPDATE_REALTIME_BATCH_WINDOW_MS = 5 * 1000;
export const UPDATE_RESOURCE_ALERT_BATCH_WINDOW_MS = 25 * 1000;
export const UPDATE_MAX_BATCH_SAMPLES = 300;
export const UPDATE_FRONTEND_SUBSCRIBER_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// Agent WSS 上报策略：默认历史写入间隔、服务器配置缓存，以及无前端订阅时的最小上报间隔。
export const AGENT_WSS_FRONTEND_BATCH_WINDOW_MS = 250;
export const AGENT_DEFAULT_HISTORY_WRITE_INTERVAL_MS = 60 * 1000;
export const AGENT_SERVER_DETAIL_TTL_MS = 120 * 1000;
export const AGENT_MIN_IDLE_WSS_REPORT_INTERVAL_MS = 60 * 1000;

// 通知发送与资源告警批处理：限制外部请求重试、单次规则评估规模和通知正文长度。
export const NOTIFICATION_MAX_RETRIES = 3;
export const NOTIFICATION_RETRY_DELAY_MS = 1000;
export const RESOURCE_ALERT_EVALUATE_RULE_BATCH_SIZE = 20;
export const RESOURCE_ALERT_EVALUATE_SERVER_BATCH_SIZE = 500;
export const RESOURCE_ALERT_NOTIFICATION_SOFT_LIMIT = 3200;

// 主题商店与远程主题资源缓存。
export const THEME_STORE_URL = 'https://raw.githubusercontent.com/huilang-me/CFSM-Theme-Store/refs/heads/main/themes.json';
export const THEME_STORE_CACHE_TTL_SECONDS = 300;
export const THEME_ASSET_CACHE_TTL_SECONDS = 3600;
export const THEME_COMMIT_CACHE_TTL_SECONDS = 86400;
export const THEME_PREVIEW_AUTH_TTL_SECONDS = 600;

// 前端实时订阅活跃标记的保留时间；用于决定 /update 是否走短批处理窗口。
export const FRONTEND_REALTIME_ACTIVE_GRACE_MS = 2 * 60 * 1000;
