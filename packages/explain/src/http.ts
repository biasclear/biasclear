// HTTP shapes: the API Gateway HTTP API event (payload format 2.0) and the
// responses. The API's own CORS settings answer preflight requests and set
// the CORS headers on real ones (API Gateway replaces the function's); the
// function sets the same headers, for the one allowed origin only, so it is
// correct on its own too.

import type { ErrorName } from "./codes.js";

export interface HttpEvent {
  version?: unknown;
  rawPath?: unknown;
  headers?: Record<string, string | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: unknown; path?: unknown; sourceIp?: unknown } };
}

export interface HttpResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export const ROUTE_PATH = "/v1/explain";

export const STATUS: Readonly<Record<ErrorName | "forbidden", number>> = {
  paused: 503,
  busy: 503,
  limit: 429,
  rules: 409,
  no_answer: 502,
  invalid: 400,
  forbidden: 403,
};

/** A header value, whatever the case of its name. */
export function header(event: HttpEvent, name: string): string | undefined {
  const headers = event.headers;
  if (headers === null || headers === undefined || typeof headers !== "object") return undefined;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === want && typeof v === "string") return v;
  return undefined;
}

function baseHeaders(origin: string | undefined): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    vary: "Origin",
  };
  if (origin !== undefined) h["access-control-allow-origin"] = origin;
  return h;
}

/** `origin` is set only when it is one of the allowed origins. */
export function jsonResponse(status: number, body: unknown, origin: string | undefined): HttpResult {
  return { statusCode: status, headers: baseHeaders(origin), body: JSON.stringify(body) };
}

export function errorResponse(error: ErrorName, status: number, origin: string | undefined): HttpResult {
  return jsonResponse(status, { v: 1, error }, origin);
}

/** A CORS preflight: allowed only from an allowed origin, for POST with a Content-Type header. */
export function preflight(event: HttpEvent, allowedOrigin: string | undefined): HttpResult {
  const method = (header(event, "access-control-request-method") ?? "").toUpperCase();
  const requested = (header(event, "access-control-request-headers") ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (allowedOrigin === undefined || method !== "POST" || requested.some((h) => h !== "content-type")) {
    return { statusCode: 403, headers: { "cache-control": "no-store", vary: "Origin" }, body: "" };
  }
  return {
    statusCode: 204,
    headers: {
      "access-control-allow-origin": allowedOrigin,
      "access-control-allow-methods": "POST",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "600",
      "cache-control": "no-store",
      vary: "Origin",
    },
    body: "",
  };
}
