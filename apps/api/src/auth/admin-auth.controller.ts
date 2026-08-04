import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	Post,
	Req,
	Res,
	UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	AdminInviteAcceptRequest,
	AdminInviteRequest,
	AdminLoginRequest,
	type AdminMeResponse,
	AdminPasswordForgotRequest,
	AdminPasswordResetRequest,
	AdminPinLoginRequest,
	AdminPinSetupRequest,
	type AuthSessionResponse,
	type GenericAcceptedResponse,
} from '@saha-textile/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AdminInviteService } from './admin-invite.service';
import { AuthService } from './auth.service';
import { Principal } from './ownership';
import { RotatesSession } from './refresh-reuse.guard';
import { type AuthenticatedPrincipal, Audience, Public, RequireRoles } from './session.guard';
import { SessionService } from './session.service';

/**
 * Admin authentication.
 *
 * `@Audience('admin')` is the isolation the owner lock requires: a storefront session
 * cookie can never satisfy these routes, and the admin session this issues can never
 * satisfy a storefront-only one — even for the same person holding both.
 */
/**
 * The one response admin recovery ever returns.
 *
 * Held as a constant so no future edit can accidentally make one branch answer differently
 * from another — that difference is the whole enumeration risk.
 */
const ADMIN_RECOVERY_ACCEPTED: GenericAcceptedResponse = {
	message: 'If the details are correct, we have sent you an email.',
};

@ApiTags('auth')
@Controller('auth/admin')
@Audience('admin')
export class AdminAuthController {
	constructor(
		private readonly auth: AuthService,
		private readonly sessions: SessionService,
		private readonly adminInvites: AdminInviteService,
	) {}

	@Post('login')
	@Public()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Admin password login by email or username' })
	async login(
		@Body(new ZodValidationPipe(AdminLoginRequest)) body: AdminLoginRequest,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<AuthSessionResponse> {
		const underLimit =
			(await this.auth.withinRateLimit('login', 'ip', request.ip)) &&
			(await this.auth.withinRateLimit('login', 'email', body.identifier.toLowerCase()));
		if (!underLimit) throw new UnauthorizedException('Too many attempts');

		const user = await this.auth.findAuthUserByIdentifier(body.identifier);
		const valid = await this.auth.verifyPassword(user, body.password);

		// A customer account must not be able to open an admin session, and the refusal
		// looks identical to a wrong password.
		if (!user || !valid || user.status !== 'active' || user.role === 'customer') {
			throw new UnauthorizedException('Invalid credentials');
		}

		await this.auth.authUserRepository.recordSuccessfulLogin(user.id, new Date().toISOString());
		const { session } = await this.sessions.establish({
			user: {
				id: user.id,
				role: user.role,
				tokenVersion: user.tokenVersion,
				permissionsVersion: user.permissionsVersion,
			},
			audience: 'admin',
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

	@Post('login/pin')
	@Public()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Admin PIN login (5 failures lock PIN use for 15 minutes)' })
	async pinLogin(
		@Body(new ZodValidationPipe(AdminPinLoginRequest)) body: AdminPinLoginRequest,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<AuthSessionResponse> {
		if (!(await this.auth.withinRateLimit('pin_login', 'ip', request.ip))) {
			throw new UnauthorizedException('Too many attempts');
		}

		const user = await this.auth.findAuthUserByIdentifier(body.identifier);
		if (!user || user.status !== 'active' || user.role === 'customer') {
			throw new UnauthorizedException('Invalid credentials');
		}

		const outcome = await this.auth.verifyAdminPin(user, body.pin);
		if (outcome === 'revalidation_required') {
			// Named separately from the brute-force lock: this one does not expire, and the
			// operator needs to know the password is the only way to clear it.
			throw new UnauthorizedException('PIN use is suspended; sign in with your password to re-enable it');
		}
		if (outcome === 'locked') {
			// Named explicitly: the operator needs to know password login still works.
			throw new UnauthorizedException('PIN is temporarily locked; sign in with your password');
		}
		if (outcome !== 'ok') throw new UnauthorizedException('Invalid credentials');

		await this.auth.authUserRepository.recordSuccessfulLogin(user.id, new Date().toISOString());
		const { session } = await this.sessions.establish({
			user: {
				id: user.id,
				role: user.role,
				tokenVersion: user.tokenVersion,
				permissionsVersion: user.permissionsVersion,
			},
			audience: 'admin',
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

	@Post('pin')
	@RequireRoles('staff', 'admin')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Set or change the admin PIN (always requires password proof)' })
	async setPin(
		@Body(new ZodValidationPipe(AdminPinSetupRequest)) body: AdminPinSetupRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
	): Promise<void> {
		if (!principal) throw new UnauthorizedException('Authentication required');

		const user = await this.auth.findAuthUserById(principal.userId);
		// Password proof on every PIN change: a hijacked session must not be able to mint
		// a second, easier credential for itself.
		if (!user || !(await this.auth.verifyPassword(user, body.currentPassword))) {
			throw new UnauthorizedException('Invalid credentials');
		}

		const pinHash = await this.auth.hashPassword(body.pin);
		await this.auth.authUserRepository.setPinHash(user.id, pinHash);
		if (body.preferredLoginMethod) {
			await this.auth.authUserRepository.setPreferredLoginMethod(user.id, body.preferredLoginMethod);
		}
	}

	/**
	 * Starts admin password recovery.
	 *
	 * Public because an operator who cannot sign in has no session to authenticate with —
	 * the emailed single-use token is the authorization for the reset that follows.
	 *
	 * The response is byte-identical for a known admin, an unknown identifier, a customer
	 * account and a disabled one. Anything that varied here would turn this endpoint into a
	 * directory of back-office accounts, which is worth more to an attacker than it is to a
	 * forgetful administrator.
	 *
	 * This is recovery, never a login method: no session is issued and no OTP is involved.
	 */
	@Post('password/forgot')
	@Public()
	@HttpCode(HttpStatus.ACCEPTED)
	@ApiOperation({ summary: 'Start admin password recovery (always answers generically)' })
	async forgotPassword(
		@Body(new ZodValidationPipe(AdminPasswordForgotRequest)) body: AdminPasswordForgotRequest,
		@Req() request: FastifyRequest,
	): Promise<GenericAcceptedResponse> {
		const identifier = body.identifier.trim().toLowerCase();
		// Limited by identifier AND source address: one throttles targeting a single
		// administrator, the other throttles sweeping many. Exceeding either still returns
		// the same accepted body, so probing the limiter reveals nothing either.
		const underLimit =
			(await this.auth.withinRateLimit('password_reset', 'email', identifier)) &&
			(await this.auth.withinRateLimit('password_reset', 'ip', request.ip));
		if (underLimit) await this.auth.startAdminPasswordReset(identifier);

		return ADMIN_RECOVERY_ACCEPTED;
	}

	/**
	 * Completes admin password recovery.
	 *
	 * Three things happen together because a reset answers a suspected compromise, and any
	 * one of them alone would leave a way back in:
	 *
	 * 1. the token is consumed atomically and must carry the `admin` audience, so a
	 *    storefront recovery link cannot reset a back-office password;
	 * 2. `setPasswordHash` bumps `tokenVersion` and every admin session is revoked, so an
	 *    attacker holding a live session loses it immediately;
	 * 3. PIN use is suspended until the administrator signs in once with the new password —
	 *    otherwise a known PIN would still open the account the reset was meant to secure.
	 *
	 * The PIN hash is kept. Deleting it silently would destroy the operator's second login
	 * method with no record; the suspension is explicit and its transitions are auditable.
	 */
	@Post('password/reset')
	@Public()
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Complete admin recovery; revokes sessions and suspends PIN use' })
	async resetPassword(
		@Body(new ZodValidationPipe(AdminPasswordResetRequest)) body: AdminPasswordResetRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<void> {
		const result = await this.auth.completePasswordReset(body.token, body.newPassword, 'admin');
		// Expired, already-used, unknown and wrong-audience tokens fail identically.
		if (!result) throw new UnauthorizedException('Invalid or expired reset token');

		await this.auth.requirePinRevalidation(result.userId);
		await this.sessions.revokeAllForUser(result.userId, 'password_changed');
		this.sessions.clearCookies(reply);
	}

	@Post('refresh')
	@Public()
	@RotatesSession()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Rotate the admin session' })
	async refresh(
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<AuthSessionResponse> {
		const { session } = await this.sessions.refresh({ request, reply, audience: 'admin' });
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
	@ApiOperation({ summary: 'Revoke the admin session' })
	async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
		await this.sessions.revoke(request, reply, 'logout');
	}

	@Get('me')
	@RequireRoles('staff', 'admin')
	@ApiOperation({ summary: 'Current admin profile — sanitized, never credential material' })
	async me(@Principal() principal: AuthenticatedPrincipal | undefined): Promise<AdminMeResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');

		const user = await this.auth.findAuthUserById(principal.userId);
		if (!user) throw new UnauthorizedException('Account not found');

		// Built field-by-field on purpose: spreading the auth state here would leak the
		// password and PIN hashes into an HTTP response.
		return {
			user: {
				id: user.id,
				email: user.email,
				emailVerified: user.emailVerified,
				username: user.username,
				role: user.role === 'customer' ? 'staff' : user.role,
				status: user.status,
				pinConfigured: Boolean(user.pinHash),
				preferredLoginMethod: user.preferredLoginMethod,
				lastLoginAt: null,
			},
			permissions: user.permissions,
			session: {
				audience: 'admin',
				expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
				refreshExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
			},
		};
	}

	/**
	 * Invites a new staff/admin account.
	 *
	 * This is the entire privilege-granting surface — there is no admin self-registration —
	 * so it is `admin`-role only and every call is audited under the seven-year tier.
	 */
	@Post('invites')
	@RequireRoles('admin')
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Invite a staff/admin account (admin only; audited)' })
	async createInvite(
		@Body(new ZodValidationPipe(AdminInviteRequest)) body: AdminInviteRequest,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<{ id: string; emailNormalized: string; role: string; expiresAt: string }> {
		if (!principal) throw new UnauthorizedException('Authentication required');

		const invite = await this.adminInvites.create({
			request: body,
			invitedByUserId: principal.userId,
			requestId: typeof request.id === 'string' ? request.id : null,
		});

		// The token is NOT returned: it exists only in the invitation email.
		return {
			id: invite.id,
			emailNormalized: invite.emailNormalized,
			role: invite.role,
			expiresAt: invite.expiresAt,
		};
	}

	@Get('invites')
	@RequireRoles('admin')
	@ApiOperation({ summary: 'List outstanding invites (admin only)' })
	async listInvites(): Promise<{
		items: Array<{ id: string; emailNormalized: string; role: string; expiresAt: string }>;
	}> {
		const invites = await this.adminInvites.listPending();
		// Projected field-by-field: `tokenHash` must never reach a response.
		return {
			items: invites.map((invite) => ({
				id: invite.id,
				emailNormalized: invite.emailNormalized,
				role: invite.role,
				expiresAt: invite.expiresAt,
			})),
		};
	}

	@Delete('invites/:id')
	@RequireRoles('admin')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Revoke an outstanding invite (admin only; audited)' })
	async revokeInvite(
		@Param('id') inviteId: string,
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
	): Promise<void> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		await this.adminInvites.revoke(inviteId, principal.userId, typeof request.id === 'string' ? request.id : null);
	}

	/**
	 * Accepts an invite and creates the account. Public because the invitee has no session
	 * yet; the single-use token IS the authorization, and consuming it is atomic so two
	 * people racing the same link cannot both create an account.
	 */
	@Post('invites/accept')
	@Public()
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Accept an admin invitation and set credentials' })
	async acceptInvite(
		@Body(new ZodValidationPipe(AdminInviteAcceptRequest)) body: AdminInviteAcceptRequest,
	): Promise<{ userId: string; role: string }> {
		const user = await this.adminInvites.accept(body);
		// No session is issued here: the new admin signs in explicitly, which exercises the
		// credential they just set rather than trusting the invite link twice.
		return { userId: user.id, role: user.role };
	}

	/**
	 * Idle quick-resume.
	 *
	 * After the 15-minute soft lock the session still EXISTS — the operator just has to
	 * prove presence again. This re-verifies the PIN for the current session's own user and
	 * extends that session, rather than issuing a new one, which is what lets the admin UI
	 * keep its mounted route and form state (owner lock 2026-07-23).
	 */
	@Post('resume')
	@RequireRoles('staff', 'admin')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Quick-resume an idle admin session with the PIN' })
	async resume(
		@Body(new ZodValidationPipe(AdminPinLoginRequest.pick({ pin: true }))) body: { pin: string },
		@Principal() principal: AuthenticatedPrincipal | undefined,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<AuthSessionResponse> {
		if (!principal) throw new UnauthorizedException('Authentication required');
		if (!(await this.auth.withinRateLimit('pin_login', 'ip', request.ip))) {
			throw new UnauthorizedException('Too many attempts');
		}

		const user = await this.auth.findAuthUserById(principal.userId);
		if (!user || user.status !== 'active') throw new UnauthorizedException('Account is not active');

		const outcome = await this.auth.verifyAdminPin(user, body.pin);
		if (outcome === 'revalidation_required') {
			// Named separately from the brute-force lock: this one does not expire, and the
			// operator needs to know the password is the only way to clear it.
			throw new UnauthorizedException('PIN use is suspended; sign in with your password to re-enable it');
		}
		if (outcome === 'locked') {
			throw new UnauthorizedException('PIN is temporarily locked; sign in with your password');
		}
		if (outcome !== 'ok') throw new UnauthorizedException('Invalid credentials');

		// Rotates the refresh token and extends the idle window on the SAME session.
		const { session } = await this.sessions.refresh({ request, reply, audience: 'admin' });
		return {
			user: await this.auth.publicUser(user.id),
			session: {
				audience: session.audience,
				expiresAt: session.expiresAt,
				refreshExpiresAt: session.absoluteExpiresAt,
			},
		};
	}
}
