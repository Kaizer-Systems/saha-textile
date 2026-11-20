import { createHash, timingSafeEqual } from 'node:crypto';

import {
	type CanActivate,
	type ExecutionContext,
	HttpException,
	HttpStatus,
	Injectable,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';

/**
 * The operations address's own key (`OPS_TOKEN`, 64 hex characters from `openssl rand -hex 32`),
 * checked at the boundary. Blank or missing switches `/ops` off: every route answers 404.
 */
export const OpsEnv = z.object({
	OPS_TOKEN: z
		.string()
		.regex(/^[a-f0-9]{64}$/, 'OPS_TOKEN must be 64 hex characters (openssl rand -hex 32).')
		.optional()
		.or(z.literal('')),
});

export function opsTokenFrom(env: NodeJS.ProcessEnv = process.env): string | null {
	return OpsEnv.parse({ OPS_TOKEN: env['OPS_TOKEN'] }).OPS_TOKEN || null;
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/** 60 reads a minute per address: the console reads once a minute per screen. */
const LIMIT = 60;
const WINDOW_MS = 60_000;

/**
 * Lets a request through only with `Authorization: Bearer <OPS_TOKEN>`, compared in constant time,
 * and at most 60 a minute per address. Without a configured key the address does not exist.
 */
@Injectable()
export class OpsTokenGuard implements CanActivate {
	private readonly token = opsTokenFrom();
	private readonly seen = new Map<string, { start: number; count: number }>();

	canActivate(context: ExecutionContext): boolean {
		if (!this.token) throw new NotFoundException();
		const req = context.switchToHttp().getRequest<{ headers: Record<string, unknown>; ip?: string }>();
		const now = Date.now();
		const key = req.ip ?? 'unknown';
		const slot = this.seen.get(key);
		if (!slot || now - slot.start >= WINDOW_MS) this.seen.set(key, { start: now, count: 1 });
		else if (++slot.count > LIMIT) throw new HttpException('Too many requests.', HttpStatus.TOO_MANY_REQUESTS);
		if (this.seen.size > 1000) this.seen.clear();
		const given = String(req.headers['authorization'] ?? '').replace(/^Bearer /, '');
		if (!timingSafeEqual(digest(given), digest(this.token))) throw new UnauthorizedException();
		return true;
	}
}
