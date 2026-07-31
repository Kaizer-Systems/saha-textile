import type { FastifyRequest } from 'fastify';

import type { AppConfig } from '../config/app-config';

/** Header carrying the correlation id in and out of the API. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Accepts only a sane correlation id so a hostile value cannot poison logs. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Resolves the correlation id for a request.
 *
 * An inbound `x-request-id` is honoured ONLY when the proxy chain is trusted — otherwise
 * any client could set it, collide with another request's id, or inject control
 * characters into the log stream. Untrusted or malformed values are replaced.
 */
export function resolveRequestId(headerValue: unknown, trustProxy: boolean, fallback: string): string {
	if (!trustProxy) return fallback;
	const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
	return typeof candidate === 'string' && SAFE_REQUEST_ID.test(candidate) ? candidate : fallback;
}

/**
 * The real client IP.
 *
 * Behind Cloudflare → Nginx, `request.ip` is the proxy. The configured header
 * (`cf-connecting-ip`) is read ONLY when `TRUST_PROXY` is on: honouring it otherwise
 * would let any caller spoof their address and walk straight through the rate limiter.
 */
export function resolveClientIp(request: FastifyRequest, config: AppConfig): string {
	if (config.trustProxy && config.clientIpHeader) {
		const header = request.headers[config.clientIpHeader.toLowerCase()];
		const value = Array.isArray(header) ? header[0] : header;
		if (typeof value === 'string' && value.trim()) return value.trim().split(',')[0]!.trim();
	}
	return request.ip;
}
