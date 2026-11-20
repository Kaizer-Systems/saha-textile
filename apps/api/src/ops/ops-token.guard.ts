import { createHash, timingSafeEqual } from 'node:crypto';

import {
	type CanActivate,
	type ExecutionContext,
	HttpException,
	HttpStatus,
	Inject,
	Injectable,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/app-config';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** 60 reads a minute per address: the console reads once a minute per screen. */
const LIMIT = 60;
const WINDOW_MS = 60_000;

/**
 * Lets a request through only with `Authorization: Bearer <OPS_TOKEN>` (`config.ops.token`; a server
 * refuses a weak one at start), compared in constant time on equal-length digests, at most 60 a minute
 * per address. Without a configured key the address does not exist: every route answers 404.
 */
@Injectable()
export class OpsTokenGuard implements CanActivate {
	private readonly token: string | null;
	private readonly seen = new Map<string, { start: number; count: number }>();

	constructor(@Inject(APP_CONFIG) config: Pick<AppConfig, 'ops'>) {
		this.token = config.ops.token ?? null;
	}

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
