export function checkAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return false;
  }

  const parts = authHeader.trim().split(/\s+/);
  const scheme = parts[0];
  const encoded = parts[1];

  if (scheme !== 'Basic' || !encoded) {
    return false;
  }

  let decoded;
  try {
    decoded = atob(encoded);
  } catch (e) {
    return false;
  }

  const idx = decoded.indexOf(':');
  if (idx === -1) {
    return false;
  }

  const username = decoded.slice(0, idx);
  const password = decoded.slice(idx + 1);

  // 确保用户名和密码都不为空，并且与环境变量匹配
  return (
    typeof env.API_USER_NAME === 'string' && 
    env.API_USER_NAME.length > 0 && 
    typeof env.API_SECRET === 'string' && 
    env.API_SECRET.length > 0 && 
    username === env.API_USER_NAME && 
    password === env.API_SECRET
  );
}

export function authResponse(realmTitle) {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${realmTitle}"` }
  });
}

// 用于公开 API 的 401 响应，不触发浏览器弹窗
export function simpleAuthResponse() {
  return new Response('Unauthorized', {
    status: 401
  });
}