import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { TokenClaims } from '@saha/core-domain';

/** Injects the authenticated user's token claims (set by JwtAuthGuard). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): TokenClaims | undefined => {
	const request = ctx.switchToHttp().getRequest<{ user?: TokenClaims }>();
	return request.user;
});
