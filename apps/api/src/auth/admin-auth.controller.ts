import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	AdminLoginRequest,
	type AdminMeResponse,
	AdminPinLoginRequest,
	AdminPinSetupRequest,
	type AuthSessionResponse,
} from '@saha-textile/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { Principal } from './ownership';
import { type AuthenticatedPrincipal, Audience, Public, RequireRoles } from './session.guard';
import { SessionService } from './session.service';

/**
 * Admin authentication.
 *
 * `@Audience('admin')` is the isolation the owner lock requires: a storefront session
 * cookie can never satisfy these routes, and the admin session this issues can never
 * satisfy a storefront-only one — even for the same person holding both.
 */
@ApiTags('auth')
@Controller('auth/admin')
@Audience('admin')
export class AdminAuthController {
	constructor(
		private readonly auth: AuthService,
		private readonly sessions: SessionService,
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

	@Post('refresh')
	@Public()
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
}
