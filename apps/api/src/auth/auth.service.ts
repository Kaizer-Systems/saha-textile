import { ConflictException, Inject, Injectable, NotImplementedException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type User, User as UserSchema } from '@saha/contracts';
import type { AuthPort, UserRepository } from '@saha/core-domain';

import { AUTH_PORT, USER_REPOSITORY } from '../infra/tokens';

export interface AuthTokens {
	accessToken: string;
	refreshToken: string;
}

export interface AuthResult extends AuthTokens {
	user: User;
}

@Injectable()
export class AuthService {
	constructor(
		@Inject(USER_REPOSITORY) private readonly users: UserRepository,
		@Inject(AUTH_PORT) private readonly auth: AuthPort,
	) {}

	async register(input: { email: string; password: string; displayName?: string }): Promise<AuthResult> {
		const email = input.email.toLowerCase();
		const existing = await this.users.findByEmail(email);
		if (existing) throw new ConflictException('An account with this email already exists');

		const user = UserSchema.parse({
			id: `user_${randomUUID()}`,
			email,
			emailVerified: false,
			displayName: input.displayName,
			role: 'customer',
			identities: [{ provider: 'password', email }],
		});
		const saved = await this.users.save(user);
		const passwordHash = await this.auth.hashPassword(input.password);
		await this.users.setPasswordHash(saved.id, passwordHash);

		return { user: saved, ...(await this.issueTokens(saved)) };
	}

	async login(input: { email: string; password: string }): Promise<AuthResult> {
		const credential = await this.users.findCredentialByEmail(input.email.toLowerCase());
		if (!credential?.passwordHash) throw new UnauthorizedException('Invalid email or password');

		const ok = await this.auth.verifyPassword(input.password, credential.passwordHash);
		if (!ok) throw new UnauthorizedException('Invalid email or password');

		return { user: credential.user, ...(await this.issueTokens(credential.user)) };
	}

	async refresh(refreshToken: string): Promise<AuthTokens> {
		let sub: string;
		try {
			const claims = await this.auth.verifyRefreshToken(refreshToken);
			sub = claims.sub;
		} catch {
			throw new UnauthorizedException('Invalid or expired refresh token');
		}
		const user = await this.users.findById(sub);
		if (!user) throw new UnauthorizedException('User no longer exists');
		return this.issueTokens(user);
	}

	async me(userId: string): Promise<User> {
		const user = await this.users.findById(userId);
		if (!user) throw new UnauthorizedException('User no longer exists');
		return user;
	}

	/** Email-OTP via Brevo — wiring deferred until the Brevo key is provided. */
	requestEmailOtp(_email: string): Promise<never> {
		throw new NotImplementedException('Email-OTP is not yet enabled (pending Brevo credentials)');
	}

	verifyEmailOtp(_email: string, _code: string): Promise<never> {
		throw new NotImplementedException('Email-OTP is not yet enabled (pending Brevo credentials)');
	}

	/** Google/Facebook OAuth — stubbed until client credentials are provided. */
	oauth(_provider: 'google' | 'facebook'): Promise<never> {
		throw new NotImplementedException('Social login is not yet enabled (pending OAuth credentials)');
	}

	private async issueTokens(user: User): Promise<AuthTokens> {
		const claims = { sub: user.id, role: user.role };
		const [accessToken, refreshToken] = await Promise.all([
			this.auth.signAccessToken(claims),
			this.auth.signRefreshToken(claims),
		]);
		return { accessToken, refreshToken };
	}
}
