import { HttpException, Injectable } from '@nestjs/common';
import type { AuthRateLimitAction } from '@saha-textile/core-domain';

import { AuthService } from '../auth/auth.service';

/** The auth limiter, so a catalogue limit is stored and survives a restart like every other. */
@Injectable()
export class CatalogRateLimit {
	constructor(private readonly auth: AuthService) {}

	async enforce(action: AuthRateLimitAction, scopes: { identifier?: string; ip: string }): Promise<void> {
		const decision = await this.auth.consumeRateLimit(action, scopes);
		if (!decision.allowed) throw new HttpException('Too many requests', 429);
	}
}
