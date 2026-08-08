import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CsrfTokenResponse } from '@saha-textile/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { SessionService } from '../auth/session.service';
import { Public } from '../auth/session.guard';
import { API_TAGS } from '../openapi-tags';

@ApiTags(API_TAGS.auth)
@Controller('auth')
/** CSRF token issuance must work before a session exists. */
@Public()
export class SecurityController {
	constructor(private readonly sessions: SessionService) {}

	/**
	 * Issues a double-submit CSRF token: returned in the body AND set as a readable
	 * cookie. The browser app echoes the value in the configured header on every
	 * state-changing request, which `CsrfGuard` then compares.
	 *
	 * Policy B for active Chunk-D sessions: preserve the existing session-bound token
	 * when the readable cookie still matches `authSessions.csrfSecretHash`. Do not mint
	 * an unrelated cookie value on GET — that desynchronizes the session and also turns
	 * cross-site SameSite=lax navigations into a CSRF denial-of-service. Missing or
	 * desynced cookies recover by atomically rotating the stored hash. Anonymous
	 * (pre-session) callers still receive an unbound token.
	 */
	@Get('csrf')
	@ApiOperation({
		operationId: 'issueCsrfToken',
		summary: 'Issue a double-submit CSRF token (also set as a readable cookie)',
	})
	@ApiOkResponse({ description: 'CSRF token issued' })
	async issueCsrfToken(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
		const token = await this.sessions.issueCsrfToken(request, reply);
		const body: CsrfTokenResponse = { csrfToken: token };
		void reply.status(200).send(body);
	}
}
