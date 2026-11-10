import {
	type CanActivate,
	type ExecutionContext,
	Injectable,
	SetMetadata,
	UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { LockService } from './lock.service.js';

export const SESSION_HEADER = 'x-console-session';
const OPEN = 'console:open';
/** Marks a route that answers without unlocking: health and the lock routes. */
export const Open = (): MethodDecorator & ClassDecorator => SetMetadata(OPEN, true);

interface HeaderRequest {
	headers: Record<string, string | string[] | undefined>;
}
export const sessionOf = (req: HeaderRequest): string | undefined => {
	const v = req.headers[SESSION_HEADER];
	return Array.isArray(v) ? v[0] : v;
};

/** Every route needs an unlocked session unless it is marked `@Open()`. */
@Injectable()
export class SessionGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly lock: LockService,
	) {}

	canActivate(ctx: ExecutionContext): boolean {
		if (this.reflector.getAllAndOverride<boolean>(OPEN, [ctx.getHandler(), ctx.getClass()])) return true;
		if (this.lock.valid(sessionOf(ctx.switchToHttp().getRequest<HeaderRequest>()))) return true;
		throw new UnauthorizedException('The console is locked.');
	}
}
