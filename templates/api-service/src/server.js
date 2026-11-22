import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { clearTimeout, setTimeout } from 'node:timers';
import { getConfig } from './config.js';
import {
  createStellarBoundary,
  getStellarNetworkDescriptor,
} from './stellar-client.js';

// Upper bound for the initialization handshake; health probes stay fast and
// local even while setup is slow, stuck, or failing.
export const INITIALIZATION_TIMEOUT_MS = 1000;

// Request bodies are bounded before buffering; rejected payloads are never
// logged or echoed back to clients.
export const MAX_REQUEST_BODY_BYTES = 64 * 1024;

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id';

// CORS is closed by default. Only explicitly configured origins are reflected,
// credentials are never enabled, and preflight never advertises more than the
// routes and headers this starter actually uses.
export const ALLOWED_CORS_METHODS = Object.freeze(['GET', 'OPTIONS']);
export const ALLOWED_CORS_HEADERS = Object.freeze([
  'content-type',
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
]);
export const CORS_MAX_AGE_SECONDS = 600;

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const METHOD_PATTERN = /^[A-Z]{1,10}$/;

export const BASELINE_SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
});

export function resolveCorrelationId(value) {
  if (typeof value === 'string' && CORRELATION_ID_PATTERN.test(value)) {
    return value;
  }

  return randomUUID();
}

export function isJsonContentType(value) {
  if (typeof value !== 'string') {
    return false;
  }

  return value.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function hasRequestBody(request) {
  const contentLengthHeader = request.headers?.['content-length'];

  if (contentLengthHeader !== undefined) {
    const contentLength = Number(contentLengthHeader);
    return Number.isFinite(contentLength) && contentLength > 0;
  }

  return request.headers?.['transfer-encoding'] !== undefined;
}

export function readJsonBody(request, maxBytes = MAX_REQUEST_BODY_BYTES) {
  if (!isJsonContentType(request.headers?.['content-type'])) {
    request.resume?.();
    return Promise.resolve({
      ok: false,
      status: 415,
      error: 'unsupported_media_type',
    });
  }

  const contentLengthHeader = request.headers?.['content-length'];
  if (contentLengthHeader !== undefined) {
    const contentLength = Number(contentLengthHeader);

    if (!Number.isInteger(contentLength) || contentLength < 0) {
      request.resume?.();
      return Promise.resolve({ ok: false, status: 400, error: 'bad_request' });
    }

    if (contentLength > maxBytes) {
      request.resume?.();
      return Promise.resolve({
        ok: false,
        status: 413,
        error: 'payload_too_large',
      });
    }
  }

  return new Promise((resolveBody) => {
    let receivedBytes = 0;
    const chunks = [];
    let settled = false;

    const rejectBody = (status, error) => {
      if (settled) {
        return;
      }

      settled = true;
      chunks.length = 0;
      request.resume?.();
      resolveBody({ ok: false, status, error });
    };

    request.on('data', (chunk) => {
      if (settled) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += buffer.length;

      if (receivedBytes > maxBytes) {
        rejectBody(413, 'payload_too_large');
        return;
      }

      chunks.push(buffer);
    });

    request.on('end', () => {
      if (settled) {
        return;
      }

      settled = true;

      if (receivedBytes === 0) {
        resolveBody({ ok: true, value: undefined });
        return;
      }

      let value;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        resolveBody({ ok: false, status: 400, error: 'malformed_json' });
        return;
      }

      resolveBody({ ok: true, value });
    });

    request.on('error', () => rejectBody(400, 'bad_request'));
    request.on('aborted', () => rejectBody(400, 'bad_request'));
  });
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    ...BASELINE_SECURITY_HEADERS,
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function sendEmpty(response, statusCode, headers = {}) {
  response.writeHead(statusCode, {
    ...BASELINE_SECURITY_HEADERS,
    ...headers,
  });
  response.end();
}

function getSafeMethod(method) {
  return typeof method === 'string' && METHOD_PATTERN.test(method)
    ? method
    : 'UNKNOWN';
}

function getSafePath(url) {
  if (typeof url !== 'string') {
    return '/';
  }

  const path = url.split('?', 1)[0].split('#', 1)[0];
  const bounded = path.length > 128 ? path.slice(0, 128) : path;
  return bounded.replace(/[^\x20-\x7e]/g, '?');
}

function resolveCors(originHeader, allowedOrigins) {
  const hasOrigin = typeof originHeader === 'string' && originHeader.length > 0;
  const origin = hasOrigin && allowedOrigins.includes(originHeader)
    ? originHeader
    : null;

  return {
    origin,
    rejected: hasOrigin && origin === null,
    headers: hasOrigin
      ? {
          ...(origin ? { 'access-control-allow-origin': origin } : {}),
          vary: 'Origin',
        }
      : {},
  };
}

function getPreflightHeaders(requestHeaders, cors) {
  const requestedMethod = String(
    requestHeaders['access-control-request-method'] ?? '',
  )
    .trim()
    .toUpperCase();
  const requestedHeaders = String(
    requestHeaders['access-control-request-headers'] ?? '',
  )
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter((header) => header.length > 0);

  if (
    !cors.origin ||
    !ALLOWED_CORS_METHODS.includes(requestedMethod) ||
    requestedHeaders.some((header) => !ALLOWED_CORS_HEADERS.includes(header))
  ) {
    return null;
  }

  return {
    ...cors.headers,
    'access-control-allow-methods': ALLOWED_CORS_METHODS.join(', '),
    'access-control-allow-headers': ALLOWED_CORS_HEADERS.join(', '),
    'access-control-max-age': String(CORS_MAX_AGE_SECONDS),
    vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
  };
}

export function createRequestHandler(
  env = globalThis.process.env,
  options = {},
) {
  const initializationTimeoutMs = Number.isFinite(options.initializationTimeoutMs)
    ? options.initializationTimeoutMs
    : INITIALIZATION_TIMEOUT_MS;
  const initialize =
    typeof options.initialize === 'function'
      ? options.initialize
      : () => Promise.resolve();
  const logger = options.logger ?? globalThis.console;
  const maxBodyBytes =
    Number.isInteger(options.maxBodyBytes) && options.maxBodyBytes > 0
      ? options.maxBodyBytes
      : MAX_REQUEST_BODY_BYTES;

  const state = { status: 'initializing' }; // 'initializing' | 'ready' | 'unavailable'
  let config;
  let stellar;

  const markUnavailable = () => {
    if (state.status === 'initializing') {
      state.status = 'unavailable';
    }
    // Never echo error details: operators get one generic, honest line.
    globalThis.console.error('Service initialization failed.');
  };

  try {
    config = getConfig(env);
    stellar = createStellarBoundary(config);
  } catch {
    markUnavailable();
  }

  if (state.status === 'initializing') {
    const timeout = setTimeout(markUnavailable, initializationTimeoutMs);
    timeout.unref?.();

    Promise.resolve()
      .then(() => initialize())
      .then(() => {
        clearTimeout(timeout);
        if (state.status === 'initializing') {
          state.status = 'ready';
        }
      })
      .catch(() => {
        clearTimeout(timeout);
        markUnavailable();
      });
  }

  return async (request, response) => {
    const correlationId = resolveCorrelationId(
      request.headers?.['x-correlation-id'] ??
        request.headers?.['x-request-id'],
    );
    const startedAt = performance.now();
    const method = getSafeMethod(request.method);
    const path = getSafePath(request.url);

    // Logged records carry only safe transport metadata. Bodies, headers, and
    // query values are never included, even when marked as secrets by callers.
    response.once('finish', () => {
      logger.info?.(
        JSON.stringify({
          method,
          path,
          status: response.statusCode,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          correlationId,
        }),
      );
    });

    const baseHeaders = {
      [CORRELATION_ID_HEADER]: correlationId,
      [REQUEST_ID_HEADER]: correlationId,
    };
    const send = (statusCode, payload, headers = {}) =>
      sendJson(response, statusCode, payload, {
        ...baseHeaders,
        ...headers,
      });

    const cors = resolveCors(
      request.headers?.origin,
      config?.corsAllowedOrigins ?? [],
    );

    if (
      request.method === 'OPTIONS' &&
      request.headers?.['access-control-request-method'] !== undefined
    ) {
      const preflightHeaders = getPreflightHeaders(request.headers ?? {}, cors);
      const vary =
        'Origin, Access-Control-Request-Method, Access-Control-Request-Headers';

      if (!preflightHeaders) {
        send(403, { error: 'origin_not_allowed' }, { vary });
        return;
      }

      sendEmpty(response, 204, {
        ...baseHeaders,
        ...preflightHeaders,
        vary,
      });
      return;
    }

    if (cors.rejected) {
      send(403, { error: 'origin_not_allowed' }, cors.headers);
      return;
    }

    if (hasRequestBody(request)) {
      const body = await readJsonBody(request, maxBodyBytes);

      if (!body.ok) {
        send(body.status, { error: body.error }, cors.headers);
        return;
      }
    }

    if (request.method === 'GET' && request.url === '/health') {
      // Liveness is local and O(1): process is up, nothing else is implied.
      // No configuration values, no Stellar calls, no initialization state.
      send(200, { status: 'ok' }, cors.headers);
      return;
    }

    if (request.method === 'GET' && request.url === '/ready') {
      if (state.status === 'ready') {
        send(200, { status: 'ready' }, cors.headers);
        return;
      }

      send(503, { status: 'unavailable' }, cors.headers);
      return;
    }

    if (request.method === 'GET' && request.url === '/stellar/network') {
      if (state.status !== 'ready' || !stellar) {
        send(503, { status: 'unavailable' }, cors.headers);
        return;
      }

      send(200, getStellarNetworkDescriptor(stellar), cors.headers);
      return;
    }

    send(404, { error: 'not_found' }, cors.headers);
  };
}

export function createApiServer(
  env = globalThis.process.env,
  options = {},
) {
  return createServer(createRequestHandler(env, options));
}
