import { initDatabase, cleanupOldData, getMetricsHistory, rebuildDatabase } from './database/schema.js';
import { checkOfflineNodes } from './services/notification.js';
import { updateDatabase, cleanupStaleSettings } from './database/updateDatabase.js';
import { handleAdminAPI } from './handlers/admin.js';
import { serveFrontend } from './handlers/frontend.js';
import { handleUpdate } from './handlers/update.js';
import { handleServerAPI, handleServersAPI } from './handlers/dashboard.js';
import { loadSettings } from './utils/settings.js';
import { checkAuth, simpleAuthResponse } from './middleware/auth.js';
import { getServerDetail, getMetricsHistoryCache, setMetricsHistoryCache } from './utils/cache.js';

async function getEncryptionKey(env) {
  // 优先使用 TURNSTILE_SECRET_KEY，回退到 API_SECRET
  // 移除硬编码默认值：未配置任一 Secret 时使用调用级随机密钥
  const secret = env.TURNSTILE_SECRET_KEY || env.API_SECRET;
  if (!secret) {
    console.error('[SECURITY] No encryption key configured! Cookie encryption will use per-invocation random key.');
    // 每次调用生成随机密钥，确保 Cookie 加密在未配置 Secret 时不会使用可预测的默认值
    const randomKey = crypto.randomUUID() + crypto.randomUUID();
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(randomKey));
    return await crypto.subtle.importKey('raw', new Uint8Array(hash).slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(hash).slice(0, 32),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  return keyMaterial;
}

async function encryptCookieData(data, env) {
  const key = await getEncryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encodedData = encoder.encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    encodedData
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptCookieData(encoded, env) {
  try {
    const key = await getEncryptionKey(env);
    const decoded = new Uint8Array(atob(encoded).split('').map(c => c.charCodeAt(0)));
    const iv = decoded.slice(0, 12);
    const ciphertext = decoded.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      ciphertext
    );
    const encoder = new TextDecoder();
    return JSON.parse(encoder.decode(decrypted));
  } catch (e) {
    console.error('Cookie decryption error:', e);
    return null;
  }
}

async function verifyTurnstileToken(token, secretKey) {
  if (!token || !secretKey) {
    return false;
  }
  
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        secret: secretKey,
        response: token
      })
    });
    
    const data = await response.json();
    return data.success === true;
  } catch (e) {
    console.error('Turnstile verification error:', e);
    return false;
  }
}

async function fetchHistoryData(env, request, id, hours, columns, sys = null) {
  if (!id) return new Response('Missing ID', { status: 400 });
  
  if (!sys) {
    sys = await loadSettings(env.DB);
  }
  const isLoggedIn = await checkAuth(request, env, sys);
  
  if (sys.is_public !== 'true' && !isLoggedIn) {
    return simpleAuthResponse();
  }
  
  if (hours > 1 && !isLoggedIn) {
    return new Response(JSON.stringify({ error: 'Unauthorized', code: 401 }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  
  const server = await getServerDetail(env.DB, id, isLoggedIn);
  if (!server) return new Response('Not Found', { status: 404 });
  
  const clampedHours = Math.min(hours, 72);
  
  const cached = getMetricsHistoryCache(id, clampedHours, columns);
  if (cached && Date.now() - cached.timestamp < 60000) {
    return new Response(JSON.stringify(cached.data), {
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
    });
  }
  
  const data = await getMetricsHistory(env.DB, id, clampedHours, columns);
  
  setMetricsHistoryCache(id, clampedHours, columns, data);
  
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' }
  });
}

export default {
  async fetch(request, env, ctx) {
    await initDatabase(env.DB);

    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    if (env.ASSETS && method === 'GET') {
      try {
        const res = await env.ASSETS.fetch(new Request(`http://static${path}`, request));
        if (res.ok) {
          return res;
        }
      } catch (e) {
      }
    }

    const sys = await loadSettings(env.DB);
    const turnstileEnabled = sys.turnstile_enabled === 'true';
    const turnstileSecretKey = sys.turnstile_secret_key || '';

    const bypassTurnstilePaths = [
      '/update',
      '/admin/api',
      '/api/config',
      '/favicon.ico',
      '/logo.svg',
      '/install.sh'
    ];

    const isApiRequest = path.startsWith('/api/') || path.startsWith('/admin/api');
    let setTurnstileCookie = false;
    
    if (turnstileEnabled && isApiRequest && !bypassTurnstilePaths.includes(path)) {
      const cookies = request.headers.get('Cookie') || '';
      const turnstileCookie = cookies.split(';').find(c => c.trim().startsWith('turnstile_verified='));
      
      let hasValidCookie = false;
      if (turnstileCookie) {
        const encryptedData = turnstileCookie.split('=')[1];
        const decrypted = await decryptCookieData(encryptedData, env);
        if (decrypted && decrypted.expires && Date.now() < decrypted.expires * 1000) {
          hasValidCookie = true;
        }
      }
      
      if (!hasValidCookie) {
        const turnstileToken = request.headers.get('X-Turnstile-Token');
        const isVerified = await verifyTurnstileToken(turnstileToken, turnstileSecretKey);
        
        if (!isVerified) {
          return new Response(JSON.stringify({ error: 'Turnstile verification failed' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        setTurnstileCookie = true;
      }
    }

    async function handleManualCleanup() {
      if (!await checkAuth(request, env, sys)) {
        return simpleAuthResponse();
      }
      
      const result = await cleanupOldData(env.DB);
      
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    async function handleUpdateDatabase() {
      if (!await checkAuth(request, env, sys)) {
        return simpleAuthResponse();
      }
      
      const result = await updateDatabase(env.DB);
      
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    async function handleRebuildDatabase() {
      if (!await checkAuth(request, env, sys)) {
        return simpleAuthResponse();
      }
      
      const result = await rebuildDatabase(env.DB);
      
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    async function handleGetConfig() {
      let cookieAuth = false;
      
      if (turnstileEnabled) {
        const cookies = request.headers.get('Cookie') || '';
        const turnstileCookie = cookies.split(';').find(c => c.trim().startsWith('turnstile_verified='));
        
        if (turnstileCookie) {
          const encryptedData = turnstileCookie.split('=')[1];
          const decrypted = await decryptCookieData(encryptedData, env);
          if (decrypted && decrypted.expires && Date.now() < decrypted.expires * 1000) {
            cookieAuth = true;
          }
        }
      }
      
      if (cookieAuth) {
        return new Response(JSON.stringify({
          turnstile_enabled: true,
          turnstile_site_key: sys.turnstile_site_key || '',
          cookie_auth: true
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        return new Response(JSON.stringify({
          turnstile_enabled: turnstileEnabled,
          turnstile_site_key: sys.turnstile_site_key || '',
          cookie_auth: false
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    const routes = [
      { method: 'GET', path: '/clear', handler: handleManualCleanup },
      { method: 'GET', path: '/updateDatabase', handler: handleUpdateDatabase },
      { method: 'GET', path: '/rebuild', handler: handleRebuildDatabase },
      { method: 'POST', path: '/admin/api', handler: async () => {
        return handleAdminAPI(request, env, sys);
      }},
      { method: 'POST', path: '/update', handler: () => handleUpdate(request, env, ctx) },
      { method: 'GET', path: '/api/server', handler: async () => {
        return handleServerAPI(request, env, sys);
      }},
      { method: 'GET', path: '/api/servers', handler: async () => {
        return handleServersAPI(request, env, sys);
      }},
      { method: 'GET', path: '/api/config', handler: handleGetConfig },
      { method: 'GET', path: '/api/history', handler: async () => {
        const id = url.searchParams.get('id');
        const metric = url.searchParams.get('metric') || 'cpu';
        const hours = parseFloat(url.searchParams.get('hours') || '24');
        return fetchHistoryData(env, request, id, hours, metric, sys);
      }},
      { method: 'GET', path: '/api/history/all', handler: async () => {
        const id = url.searchParams.get('id');
        const hours = parseFloat(url.searchParams.get('hours') || '24');
        const allColumns = 'cpu, ram, disk, processes, net_in_speed, net_out_speed, tcp_conn, udp_conn, ping_ct, ping_cu, ping_cm, ping_bd, swap_total, swap_used, load_avg';
        return fetchHistoryData(env, request, id, hours, allColumns, sys);
      }}
    ];

    for (const route of routes) {
      if (route.method === method && route.path === path) {
        const response = await route.handler();
        
        if (setTurnstileCookie && response) {
          const expires = Math.floor(Date.now() / 1000) + 3600;
          const cookieData = { expires, verified: true, timestamp: Date.now() };
          const encryptedCookie = await encryptCookieData(cookieData, env);
          
          const newHeaders = new Headers(response.headers);
          newHeaders.set('Set-Cookie', `turnstile_verified=${encryptedCookie}; path=/; max-age=3600; SameSite=Lax; HttpOnly`);
          
          const newResponse = new Response(response.body, {
            status: response.status,
            headers: newHeaders
          });
          return newResponse;
        }
        
        return response;
      }
    }

    return serveFrontend(request, env);
  },

  async scheduled(event, env, ctx) {
    await initDatabase(env.DB);
    
    const cron = event.cron;
    console.log(`[Cron] 定时任务触发: ${cron}`);
    
    if (cron === '50 23 * * *') {
      console.log('[Cron] 开始执行每日数据清理任务');
      await cleanupOldData(env.DB);
      console.log('[Cron] 每日数据清理任务完成');
    } else if (cron === '*/1 * * * *') {
      console.log('[Cron] 开始执行离线节点检测');
      await checkOfflineNodes(env.DB);
      console.log('[Cron] 离线节点检测完成');
    }
  }
};