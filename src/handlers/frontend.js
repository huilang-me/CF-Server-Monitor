import { loadSettings } from '../utils/settings.js';

let filesCache = null;

/**
 * 构建安全响应头
 * - CSP 限制脚本来源，防范 XSS
 * - 禁止 MIME 类型嗅探
 * - 禁止 iframe 嵌入
 */
function securityHeaders() {
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  };
}

/**
 * HTML 实体转义：将 & < > " ' 转换为安全形式
 * 用于防止用户输入被注入到 HTML 上下文中
 */
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * CSS 字符串转义：仅转义反斜杠和引号，防止 CSS 注入
 * 用于 url() 或字符串上下文
 */
function escapeCssString(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

async function loadFrontendFiles(env) {
  if (filesCache) return filesCache;

  try {
    const files = {};
    
    // 尝试从 Cloudflare Pages/Asset 绑定读取
    if (env.ASSETS) {
      try {
        // 主要文件
        const mainFiles = ['dashboard.html', 'style.css'];
        for (const filename of mainFiles) {
          try {
            const res = await env.ASSETS.fetch(new Request(`http://static/${filename}`));
            if (res.ok) {
              files[filename] = await res.text();
            }
          } catch (e) {
            // 忽略错误
          }
        }
      } catch (e) {
        console.log('[INFO] No ASSETS binding');
      }
    }

    filesCache = files;
    return filesCache;
  } catch (e) {
    console.error('[ERROR] Failed to load frontend files:', e);
    return {};
  }
}

function injectAppearanceSettings(html, settings) {
  let modifiedHtml = html;

  // 1. 更新页面标题 (HTML 转义防止注入)
  const siteTitle = escapeHtml(settings.site_title || 'Server Monitor');
  modifiedHtml = modifiedHtml.replace(/<title>.*<\/title>/, `<title>${siteTitle}</title>`);

  // 2. 注入 custom_head (在 </head> 标签前)
  // 安全说明：custom_head 为管理员可信任配置，允许注入任意 HTML
  // 如需要多用户环境，请对此字段做额外的 HTML 净化处理
  if (settings.custom_head) {
    modifiedHtml = modifiedHtml.replace('</head>', `${settings.custom_head}\n</head>`);
  }

  // 3. 注入 custom_script (在 </body> 标签前)
  // 安全说明：custom_script 为管理员可信任配置，允许注入任意 JS
  // 如需要多用户环境，请对此字段做额外的 JS 净化处理
  if (settings.custom_script) {
    modifiedHtml = modifiedHtml.replace('</body>', `<script>${settings.custom_script}</script>\n</body>`);
  }

  // 4. 注入 custom_bg (CSS 字符串已转义，防止注入)
  if (settings.custom_bg) {
    const safeBg = escapeCssString(settings.custom_bg);
    const bgStyle = `\n<style>\n  body { background-image: url('${safeBg}'); background-size: cover; background-attachment: fixed; background-position: center; }\n</style>\n`;
    modifiedHtml = modifiedHtml.replace('</head>', `${bgStyle}\n</head>`);
  }

  return modifiedHtml;
}

export async function serveFrontend(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  const files = await loadFrontendFiles(env);
  
  // Vue SPA - 所有路由都返回 dashboard.html
  let html = files['dashboard.html'];

  if (html) {
    // 加载并注入外观设置
    const settings = await loadSettings(env.DB);
    html = injectAppearanceSettings(html, settings);

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'CDN-Cache-Control': 'no-store',
        ...securityHeaders()
      }
    });
  }

  return new Response('Frontend not available. Please build the frontend first with `npm run build:frontend`.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' }
  });
}
