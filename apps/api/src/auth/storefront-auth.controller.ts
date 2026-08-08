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
import { tooManyRequests } from './rate-limit-response';
import { RotatesSession } from './refresh-reuse.guard';
import { type AuthenticatedPrincipal, Audience, Public } from './session.guard';
import { SessionService } from './session.service';
import { API_TAGS } from '../openapi-tags';

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

@ApiTags(API_TAGS.auth)
@Controller('auth/storefront')
@Audience('storefront')
export class StorefrontAuthController {
	constructor(
		private readonly auth: AuthService,
		private readonly sessions: SessionService,
	) {}

	@Post('register')
	@Public()
	@ApiOperation({ operationId: 'registerCustomer', summary: 'Register a storefront account and start a session' })
	async register(
		@Body(new ZodValidationPipe(RegisterStorefrontRequest)) body: RegisterStorefrontRequest,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<AuthSessionResponse> {
		const email = this.auth.normalizeEmail(body.email);
		// Attempt-counted: registration creates an account and sends a verification email, so
		// the cost lands on success too and failure counting cannot protect it.
		const limit = await this.auth.consumeRateLimit('storefront_register', { identifier: email, ip: request.ip });
		if (!limit.allowed) throw tooManyRequests(limit, reply);

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
	@ApiOperation({
		operationId: 'loginCustomerWithPassword',
		summary: 'Password login (sets httpOnly session cookies)',
	})
	async login(
		@Body(new ZodValidationPipe(PasswordLoginRequest)) body: PasswordLoginRequest,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<AuthSessionResponse> {
		const email = this.auth.normalizeEmail(body.email);
		const scopes = { identifier: email, ip: request.ip };
		const limit = await this.auth.checkRateLimit('storefront_login', scopes);
		if (!limit.allowed) {
			// An address-scoped refusal is about the network, so it may be stated plainly. An
			// identifier-scoped one keeps the generic credential failure, so an attacker
			// cannot read the response to learn when their budget resets.
			if (limit.scope === 'ip') throw tooManyRequests(limit, reply);
			throw new UnauthorizedException('Invalid credentials');
		}

		const user = await this.auth.findAuthUserByEmail(email);
		const valid = await this.auth.verifyPassword(user, body.password);

		// One message for every failure mode: unknown address, wrong password, and
		// non-active account are indistinguishable to the caller.
		if (!user || !valid || user.status !== 'active') {
			// Only failures are counted, so a signed-in customer never spends budget they
			// share with thousands of others behind the same carrier-grade NAT address.
			await this.auth.recordRateLimitFailure('storefront_login', scopes);
			throw new UnauthorizedException('Invalid credentials');
		}

		// Success clears this account's budget — never the shared address budget, which an
		// attacker could otherwise wipe by logging into an account they control.
		await this.auth.clearRateLimitIdentifier('storefront_login', email);

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
	@ApiOperation({
		operationId: 'requestCustomerEmailOtp',
		summary: 'Request an email OTP (always answers generically)',
	})
	@ApiOkResponse({ description: 'Accepted — identical whether or not the account exists' })
	async requestOtp(
		@Body(new ZodValidationPipe(EmailOtpRequest)) body: EmailOtpRequest,
		@Req() request: FastifyRequest,
	): Promise<GenericAcceptedResponse> {
		const email = this.auth.normalizeEmail(body.email);
		// Refusal answers exactly like a real send. A 429 here would tell a caller which
		// addresses have been asked for recently, which is the enumeration this endpoint
		// exists to avoid.
		const limit = await this.auth.consumeRateLimit('otp_request', { identifier: email, ip: request.ip });
		if (!limit.allowed) return ACCEPTED;

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
	@ApiOperation({ operationId: 'verifyCustomerEmailOtp', summary: 'Verify an email OTP and start a session' })
	async verifyOtp(
		@Body(new ZodValidationPipe(EmailOtpVerifyRequest)) body: EmailOtpVerifyRequest,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<AuthSessionResponse> {
		const email = this.auth.normalizeEmail(body.email);
		const scopes = { identifier: email, ip: request.ip };
		const limit = await this.auth.checkRateLimit('otp_verify', scopes);
		if (!limit.allowed) {
			if (limit.scope === 'ip') throw tooManyRequests(limit, reply);
			throw new UnauthorizedException('Invalid or expired code');
		}

		const result = await this.auth.verifyOtp({ identifier: email, purpose: 'login', code: body.code });
		if (!result?.userId) {
			await this.auth.recordRateLimitFailure('otp_verify', scopes);
			throw new UnauthorizedException('Invalid or expired code');
		}
		await this.auth.clearRateLimitIdentifier('otp_verify', email);

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
	@ApiOperation({
		operationId: 'refreshCustomerSession',
		summary: 'Rotate the session (reuse of an old token revokes the family)',
	})
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
	@ApiOperation({ operationId: 'logoutCustomer', summary: 'Revoke the current session and clear cookies' })
	async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
		await this.sessions.revoke(request, reply, 'logout');
	}

	@Post('password/forgot')
	@Public()
	@HttpCode(HttpStatus.ACCEPTED)
	@ApiOperation({
		operationId: 'requestCustomerPasswordReset',
		summary: 'Start a password reset (always answers generically)',
	})
	async forgotPassword(
		@Body(new ZodValidationPipe(PasswordForgotRequest)) body: PasswordForgotRequest,
		@Req() request: FastifyRequest,
	): Promise<GenericAcceptedResponse> {
		const email = this.auth.normalizeEmail(body.email);
		// Refused or not, the answer is identical: this endpoint must never confirm that an
		// address is known, and a rate-limit response would do exactly that.
		const limit = await this.auth.consumeRateLimit('password_reset', { identifier: email, ip: request.ip });
		if (limit.allowed) {
			await this.auth.startPasswordReset(email, 'storefront');
		}
		return ACCEPTED;
	}

	@Post('password/reset')
	@Public()
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({
		operationId: 'resetCustomerPassword',
		summary: 'Complete a password reset; revokes every existing session',
	})
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
	@ApiOperation({ operationId: 'getCurrentCustomer', summary: 'Current storefront user (requires a session cookie)' })
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
	@ApiOperation({ operationId: 'verifyCustomerEmail', summary: 'Complete email verification with a token' })
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
	@ApiOperation({
		operationId: 'resendCustomerEmailVerification',
		summary: 'Re-send the verification email for the current account',
	})
	async resendVerification(
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<GenericAcceptedResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');

		const user = await this.auth.findAuthUserById(principal.userId);
		// Already-verified and rate-limited callers get the same answer as a real send.
		if (user?.email && !user.emailVerified) {
			const limit = await this.auth.consumeRateLimit('otp_request', { identifier: user.email, ip: request.ip });
			if (limit.allowed) {
				await this.auth.issueEmailVerification(user.id, user.email);
			}
		}
		return ACCEPTED;
	}
}
