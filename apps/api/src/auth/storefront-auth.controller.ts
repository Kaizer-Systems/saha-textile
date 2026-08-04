import { randomUUID } from 'node:crypto';

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	type AuthSessionResponse,
	EmailOtpRequest,
	EmailOtpVerifyRequest,
	type GenericAcceptedResponse,
	PasswordForgotRequest,
	PasswordLoginRequest,
	PasswordResetRequest,
	RegisterStorefrontRequest,
} from '@saha-textile/contracts';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { Principal } from './ownership';
import { RotatesSession } from './refresh-reuse.guard';
import { type AuthenticatedPrincipal, Audience, Public } from './session.guard';
import { SessionService } from './session.service';

/**
 * The one response every enumeration-sensitive endpoint returns.
 *
 * Owner lock: OTP requests and forgotten-password requests answer identically whether or
 * not the account exists. Anything that varies — status code, body, or which field is
 * named — turns the endpoint into a directory of registered customers.
 */
const ACCEPTED: GenericAcceptedResponse = {
	message: 'If the details are correct, we have sent you an email.',
};

@ApiTags('auth')
@Controller('auth/storefront')
@Audience('storefront')
export class StorefrontAuthController {
	constructor(
		private readonly auth: AuthService,
		private readonly sessions: SessionService,
	) {}

	@Post('register')
	@Public()
	@ApiOperation({ summary: 'Register a storefront account and start a session' })
	async register(
		@Body(new ZodValidationPipe(RegisterStorefrontRequest)) body: RegisterStorefrontRequest,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<AuthSessionResponse> {
		const email = this.auth.normalizeEmail(body.email);
		if (!(await this.auth.withinRateLimit('login', 'ip', request.ip))) {
			throw new UnauthorizedException('Too many attempts');
		}

		const existing = await this.auth.findAuthUserByEmail(email);
		if (existing) {
			// Do not confirm that the address is taken. The account owner is told by email;
			// a stranger learns nothing.
			await this.auth.startPasswordReset(email, 'storefront');
			throw new UnauthorizedException('Registration could not be completed');
		}

		const passwordHash = await this.auth.hashPassword(body.password);
		const user = await this.auth.userRepository.save({
			id: `user_${randomUUID()}`,
			email,
			emailVerified: false,
			phone: null,
			phoneVerified: false,
			displayName: body.displayName,
			role: 'customer',
			status: 'active',
			identities: [{ provider: 'password', email }],
			addresses: [],
			guestCartId: body.guestCartId ?? null,
		});
		await this.auth.authUserRepository.setPasswordHash(user.id, passwordHash);
		await this.auth.issueEmailVerification(user.id, email);

		const state = await this.auth.findAuthUserById(user.id);
		const { session } = await this.sessions.establish({
			user: {
				id: user.id,
				role: 'customer',
				tokenVersion: state?.tokenVersion ?? 0,
				permissionsVersion: state?.permissionsVersion ?? 0,
			},
			audience: 'storefront',
			request,
			reply,
		});

		return {
			user: await this.auth.publicUser(user.id),
			session: {
				audience: session.audience,
				expiresAt: session.expiresAt,
				refreshExpiresAt: session.absoluteExpiresAt,
			},
		};
	}

	@Post('login/password')
	@Public()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Password login (sets httpOnly session cookies)' })
	async login(
		@Body(new ZodValidationPipe(PasswordLoginRequest)) body: PasswordLoginRequest,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<AuthSessionResponse> {
		const email = this.auth.normalizeEmail(body.email);
		const underLimit =
			(await this.auth.withinRateLimit('login', 'ip', request.ip)) &&
			(await this.auth.withinRateLimit('login', 'email', email));
		if (!underLimit) throw new UnauthorizedException('Too many attempts');

		const user = await this.auth.findAuthUserByEmail(email);
		const valid = await this.auth.verifyPassword(user, body.password);

		// One message for every failure mode: unknown address, wrong password, and
		// non-active account are indistinguishable to the caller.
		if (!user || !valid || user.status !== 'active') throw new UnauthorizedException('Invalid credentials');

		// A storefront password login must never mint an admin session.
		await this.auth.authUserRepository.recordSuccessfulLogin(user.id, new Date().toISOString());
		const { session } = await this.sessions.establish({
			user: {
				id: user.id,
				role: user.role,
				tokenVersion: user.tokenVersion,
				permissionsVersion: user.permissionsVersion,
			},
			audience: 'storefront',
			request,
			reply,
		});

		return {
			user: await this.auth.publicUser(user.id),
			session: {
				audience: session.audience,
				expiresAt: session.expiresAt,
				refreshExpiresAt: session.absoluteExpiresAt,
			},
		};
	}

	@Post('login/email-otp/request')
	@Public()
	@HttpCode(HttpStatus.ACCEPTED)
	@ApiOperation({ summary: 'Request an email OTP (always answers generically)' })
	@ApiOkResponse({ description: 'Accepted — identical whether or not the account exists' })
	async requestOtp(
		@Body(new ZodValidationPipe(EmailOtpRequest)) body: EmailOtpRequest,
		@Req() request: FastifyRequest,
	): Promise<GenericAcceptedResponse> {
		const email = this.auth.normalizeEmail(body.email);
		if (!(await this.auth.withinRateLimit('otp_request', 'email', email))) return ACCEPTED;
		if (!(await this.auth.withinRateLimit('otp_request', 'ip', request.ip))) return ACCEPTED;

		const user = await this.auth.findAuthUserByEmail(email);
		if (body.purpose === 'login' && (!user || user.status !== 'active')) return ACCEPTED;

		await this.auth.issueOtp({
			identifier: email,
			purpose: body.purpose,
			channel: 'email',
			userId: user?.id ?? null,
		});
		return ACCEPTED;
	}

	@Post('login/email-otp/verify')
	@Public()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Verify an email OTP and start a session' })
	async verifyOtp(
		@Body(new ZodValidationPipe(EmailOtpVerifyRequest)) body: EmailOtpVerifyRequest,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<AuthSessionResponse> {
		const email = this.auth.normalizeEmail(body.email);
		if (!(await this.auth.withinRateLimit('otp_verify', 'email', email))) {
			throw new UnauthorizedException('Too many attempts');
		}

		const result = await this.auth.verifyOtp({ identifier: email, purpose: 'login', code: body.code });
		if (!result?.userId) throw new UnauthorizedException('Invalid or expired code');

		const user = await this.auth.findAuthUserById(result.userId);
		if (!user || user.status !== 'active') throw new UnauthorizedException('Invalid or expired code');

		const { session } = await this.sessions.establish({
			user: {
				id: user.id,
				role: user.role,
				tokenVersion: user.tokenVersion,
				permissionsVersion: user.permissionsVersion,
			},
			audience: 'storefront',
			request,
			reply,
		});

		return {
			user: await this.auth.publicUser(user.id),
			session: {
				audience: session.audience,
				expiresAt: session.expiresAt,
				refreshExpiresAt: session.absoluteExpiresAt,
			},
		};
	}

	@Post('refresh')
	@Public()
	@RotatesSession()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Rotate the session (reuse of an old token revokes the family)' })
	async refresh(
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<AuthSessionResponse> {
		const { session } = await this.sessions.refresh({ request, reply, audience: 'storefront' });
		return {
			user: await this.auth.publicUser(session.userId),
			session: {
				audience: session.audience,
				expiresAt: session.expiresAt,
				refreshExpiresAt: session.absoluteExpiresAt,
			},
		};
	}

	@Post('logout')
	@Public()
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Revoke the current session and clear cookies' })
	async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
		await this.sessions.revoke(request, reply, 'logout');
	}

	@Post('password/forgot')
	@Public()
	@HttpCode(HttpStatus.ACCEPTED)
	@ApiOperation({ summary: 'Start a password reset (always answers generically)' })
	async forgotPassword(
		@Body(new ZodValidationPipe(PasswordForgotRequest)) body: PasswordForgotRequest,
	): Promise<GenericAcceptedResponse> {
		const email = this.auth.normalizeEmail(body.email);
		if (await this.auth.withinRateLimit('password_reset', 'email', email)) {
			await this.auth.startPasswordReset(email, 'storefront');
		}
		return ACCEPTED;
	}

	@Post('password/reset')
	@Public()
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Complete a password reset; revokes every existing session' })
	async resetPassword(
		@Body(new ZodValidationPipe(PasswordResetRequest)) body: PasswordResetRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<void> {
		const result = await this.auth.completePasswordReset(body.token, body.newPassword);
		if (!result) throw new UnauthorizedException('Invalid or expired reset token');

		// A reset answers a suspected compromise: every other signed-in device is signed out.
		await this.sessions.revokeAllForUser(result.userId, 'password_changed');
		this.sessions.clearCookies(reply);
	}

	@Get('me')
	@ApiOperation({ summary: 'Current storefront user (requires a session cookie)' })
	async me(@Principal() principal: AuthenticatedPrincipal | undefined) {
		if (!principal) throw new UnauthorizedException('Authentication required');
		return { user: await this.auth.publicUser(principal.userId) };
	}

	/**
	 * Redeems an email-verification token.
	 *
	 * Public because the whole point is that the recipient may not be signed in when they
	 * click the link. The token is single-use and consumed atomically, so a forwarded link
	 * cannot verify the address twice.
	 */
	@Post('email/verify')
	@Public()
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Complete email verification with a token' })
	async verifyEmail(
		@Body(new ZodValidationPipe(z.object({ token: z.string().min(1) }))) body: { token: string },
	): Promise<void> {
		const verified = await this.auth.completeEmailVerification(body.token);
		// Expired, already-used and unknown tokens are indistinguishable.
		if (!verified) throw new UnauthorizedException('Invalid or expired verification token');
	}

	/**
	 * Re-sends the verification email for the signed-in account.
	 *
	 * Requires a session rather than taking an address: an unauthenticated resend endpoint
	 * that accepts any email is both an enumeration oracle and a way to have us mail
	 * strangers on demand.
	 */
	@Post('email/verify/resend')
	@HttpCode(HttpStatus.ACCEPTED)
	@ApiOperation({ summary: 'Re-send the verification email for the current account' })
	async resendVerification(
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<GenericAcceptedResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');

		const user = await this.auth.findAuthUserById(principal.userId);
		// Already-verified and rate-limited callers get the same answer as a real send.
		if (user?.email && !user.emailVerified) {
			if (await this.auth.withinRateLimit('otp_request', 'email', user.email)) {
				await this.auth.issueEmailVerification(user.id, user.email);
			}
		}
		return ACCEPTED;
	}
}
