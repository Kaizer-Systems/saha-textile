import * as argon2 from 'argon2';
import type { AuthPort, TokenClaims } from '@saha-textile/core-domain';
import jwt, { type SignOptions } from 'jsonwebtoken';

import type { AppConfig } from '../config/app-config';

/**
 * AuthPort implementation: argon2id password hashing + JWT access/refresh tokens.
 * Access and refresh tokens are signed with separate secrets so a leaked access
 * secret cannot mint refresh tokens.
 */
export class Argon2JwtAuth implements AuthPort {
	constructor(private readonly config: AppConfig) {}

	hashPassword(plain: string): Promise<string> {
		return argon2.hash(plain, { type: argon2.argon2id });
	}

	async verifyPassword(plain: string, hash: string): Promise<boolean> {
		try {
			return await argon2.verify(hash, plain);
		} catch {
			return false;
		}
	}

	signAccessToken(claims: TokenClaims): Promise<string> {
		return this.sign(claims, this.config.jwt.accessSecret, this.config.jwt.accessTtl);
	}

	signRefreshToken(claims: TokenClaims): Promise<string> {
		return this.sign(claims, this.config.jwt.refreshSecret, this.config.jwt.refreshTtl);
	}

	verifyToken(token: string): Promise<TokenClaims> {
		return new Promise((resolve, reject) => {
			jwt.verify(token, this.config.jwt.accessSecret, (err, decoded) => {
				if (err || !decoded || typeof decoded === 'string') {
					reject(new Error('invalid token'));
					return;
				}
				resolve(decoded as TokenClaims);
			});
		});
	}

	verifyRefreshToken(token: string): Promise<TokenClaims> {
		return new Promise((resolve, reject) => {
			jwt.verify(token, this.config.jwt.refreshSecret, (err, decoded) => {
				if (err || !decoded || typeof decoded === 'string') {
					reject(new Error('invalid refresh token'));
					return;
				}
				resolve(decoded as TokenClaims);
			});
		});
	}

	private sign(claims: TokenClaims, secret: string, expiresIn: string): Promise<string> {
		const options = { expiresIn } as SignOptions;
		return new Promise((resolve, reject) => {
			jwt.sign(claims, secret, options, (err, token) => {
				if (err || !token) {
					reject(err ?? new Error('failed to sign token'));
					return;
				}
				resolve(token);
			});
		});
	}
}
