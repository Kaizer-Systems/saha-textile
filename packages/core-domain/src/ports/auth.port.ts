export interface TokenClaims {
	sub: string;
	role: string;
	[key: string]: unknown;
}

/** Auth primitives port: password hashing (argon2id) + JWT signing/verifying. */
export interface AuthPort {
	hashPassword(plain: string): Promise<string>;
	verifyPassword(plain: string, hash: string): Promise<boolean>;
	signAccessToken(claims: TokenClaims): Promise<string>;
	signRefreshToken(claims: TokenClaims): Promise<string>;
	/** Verify an access token (signed with the access secret). */
	verifyToken(token: string): Promise<TokenClaims>;
	/** Verify a refresh token (signed with the separate refresh secret). */
	verifyRefreshToken(token: string): Promise<TokenClaims>;
}
