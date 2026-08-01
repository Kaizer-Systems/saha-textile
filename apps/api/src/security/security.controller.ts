import { randomBytes } from 'node:crypto';

import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CsrfTokenResponse } from '@saha-textile/contracts';
import type { FastifyReply } from 'fastify';

import { cookieNames, csrfCookieOptions } from '../common/cookies';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { Public } from '../auth/session.guard';

/** 32 bytes of CSPRNG entropy, base64url — not guessable, not a credential. */
function generateCsrfToken(): string {
	return randomBytes(32).toString('base64url');
}

@ApiTags('auth')
@Controller('auth')
/** CSRF token issuance must work before a session exists. */
@Public()
export class SecurityController {
	constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

	/**
	 * Issues a double-submit CSRF token: returned in the body AND set as a readable
	 * cookie. The browser app echoes the value in the configured header on every
	 * state-changing request, which `CsrfGuard` then compares.
	 *
	 * Chunk C scope: token issuance and validation only. Chunk D binds the token to a
	 * server-side session (`authSessions.csrfSecretHash`) so a token from one session
	 * cannot be replayed against another.
	 */
	@Get('csrf')
	@ApiOperation({ summary: 'Issue a double-submit CSRF token (also set as a readable cookie)' })
	@ApiOkResponse({ description: 'CSRF token issued' })
	issueCsrfToken(@Res() reply: FastifyReply): void {
		const token = generateCsrfToken();
		const body: CsrfTokenResponse = { csrfToken: token };

		void reply
			.setCookie(cookieNames(this.config).csrf, token, csrfCookieOptions(this.config))
			.status(200)
			.send(body);
	}
}
