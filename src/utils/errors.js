export class AppError extends Error {
  constructor(message, code = 500, details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export function createErrorResponse(error, logError = true) {
  if (logError) {
    if (error instanceof AppError) {
      console.error(`[Error] ${error.code}: ${error.message}`, error.details || '');
    } else {
      console.error('[Error] Unexpected:', error.message, error.stack);
    }
  }

  const code = error instanceof AppError ? error.code : 500;
  const message = error instanceof AppError 
    ? error.message 
    : 'Internal Server Error';

  return new Response(JSON.stringify({ 
    error: message, 
    code: code 
  }), {
    status: code,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function createSuccessResponse(data, headers = {}) {
  const defaultHeaders = { 'Content-Type': 'application/json' };
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...defaultHeaders, ...headers }
  });
}

export function createUnauthorizedResponse(message = 'Unauthorized') {
  return new Response(JSON.stringify({ 
    error: message, 
    code: 401 
  }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function createBadRequestResponse(message = 'Bad Request') {
  return new Response(JSON.stringify({ 
    error: message, 
    code: 400 
  }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function createNotFoundResponse(message = 'Not Found') {
  return new Response(JSON.stringify({ 
    error: message, 
    code: 404 
  }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function createConflictResponse(message = 'versionConflict', details = {}) {
  return new Response(JSON.stringify({
    error: message,
    code: 409,
    conflictCode: 'VERSION_CONFLICT',
    ...details
  }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' }
  });
}
