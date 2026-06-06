const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' };

async function generateKeyFromSecret(secret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  return await crypto.subtle.importKey('raw', keyData, ALGORITHM, false, ['sign', 'verify']);
}

async function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '');
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '');
  
  const data = `${encodedHeader}.${encodedPayload}`;
  const key = await generateKeyFromSecret(secret);
  
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(data);
  const signature = await crypto.subtle.sign(ALGORITHM, key, dataBytes);
  
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '');
  
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

async function verifyJwt(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    
    const key = await generateKeyFromSecret(secret);
    
    const data = `${encodedHeader}.${encodedPayload}`;
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(data);
    
    const signatureBytes = new Uint8Array(atob(encodedSignature).split('').map(c => c.charCodeAt(0)));
    
    const isValid = await crypto.subtle.verify(ALGORITHM, key, signatureBytes, dataBytes);
    
    if (!isValid) {
      return null;
    }
    
    const payload = JSON.parse(atob(encodedPayload));
    
    if (payload.exp && Date.now() > payload.exp * 1000) {
      return null;
    }
    
    return payload;
  } catch (e) {
    console.error('JWT verification error:', e);
    return null;
  }
}

function getJwtSecret(env, sys) {
  if (sys && sys.jwt_secret && sys.jwt_secret.length >= 32) {
    return sys.jwt_secret;
  }
  
  if (env.API_SECRET) {
    return env.API_SECRET.padEnd(32, 'x').substring(0, 64);
  }
  
  // 未配置 API_SECRET 时使用每次调用随机密钥，确保 JWT 验证必然失败
  // 这比使用硬编码默认值更安全，因为硬编码默认值可被攻击者从源码中读取
  console.error('[SECURITY] API_SECRET is not configured! JWT authentication will be unavailable.');
  return crypto.randomUUID().repeat(2).substring(0, 64);
}

export async function generateToken(env, sys) {
  const payload = {
    sub: 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 604800
  };
  
  const secret = getJwtSecret(env, sys);
  return signJwt(payload, secret);
}

export async function checkAuth(request, env, sys) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return false;
  }

  const parts = authHeader.trim().split(/\s+/);
  const scheme = parts[0];
  const token = parts[1];

  if (scheme !== 'Bearer' || !token) {
    return false;
  }

  const secret = getJwtSecret(env, sys);
  
  try {
    const payload = await verifyJwt(token, secret);
    return payload !== null;
  } catch (e) {
    console.error('Auth check error:', e);
    return false;
  }
}

export async function validateCredentials(request, env) {
  try {
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

    return (
      typeof env.API_USER_NAME === 'string' && 
      env.API_USER_NAME.length > 0 && 
      typeof env.API_SECRET === 'string' && 
      env.API_SECRET.length > 0 && 
      username === env.API_USER_NAME && 
      password === env.API_SECRET
    );
  } catch (e) {
    console.error('Credential validation error:', e);
    return false;
  }
}

export function authResponse(realmTitle) {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': `Bearer realm="${realmTitle}"` }
  });
}

export function simpleAuthResponse() {
  return new Response(JSON.stringify({ error: 'Unauthorized', code: 401 }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
}