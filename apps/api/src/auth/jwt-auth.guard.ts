import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthPort, TokenClaims } from '@saha-textile/core-domain';

import { AUTH_PORT } from '../infra/tokens';

@Injectable()
export class JwtAuthGuard implements CanActivate {
	constructor(@Inject(AUTH_PORT) private readonly auth: AuthPort) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown>; user?: TokenClaims }>();
		const header = request.headers.authorization;
		if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
			throw new UnauthorizedException('Missing or malformed Authorization header');
		}
		const token = header.slice('Bearer '.length).trim();
		try {
			request.user = await this.auth.verifyToken(token);
			return true;
		} catch {
			throw new UnauthorizedException('Invalid or expired token');
		}
	}
}
