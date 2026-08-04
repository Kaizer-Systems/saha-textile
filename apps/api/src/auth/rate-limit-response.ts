import { HttpException, HttpStatus } from '@nestjs/common';
import type { RateLimitDecision } from '@saha-textile/core-domain';
import type { FastifyReply } from 'fastify';

export type RefusedRateLimit = Extract<RateLimitDecision, { allowed: false }>;

/**
 * The response for an ADDRESS-scoped refusal.
 *
 * `429` with `Retry-After` is safe here and useful: the limit is a property of the caller's
 * network, not of any account, so saying so reveals nothing about who exists. It also gives
 * an honest user something actionable instead of a "wrong password" they typed correctly.
 *
 * Identifier-scoped refusals deliberately do NOT use this. There the generic `401` is kept,
 * so an attacker cannot use the response to learn when a budget resets and pace themselves
 * against it — and anti-enumeration endpoints keep their generic accepted answer instead.
 */
export function tooManyRequests(decision: RefusedRateLimit, reply?: FastifyReply): HttpException {
	if (reply) void reply.header('retry-after', String(decision.retryAfterSeconds));
	return new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
}
