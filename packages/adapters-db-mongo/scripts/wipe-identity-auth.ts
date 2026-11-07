/**
 * D6 local wipe: clear identity/auth collections without touching catalog/commerce.
 * Usage: MONGODB_PORT=27018 pnpm exec tsx scripts/wipe-identity-auth.ts
 */
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';

const IDENTITY_COLLECTIONS = [
	'customers',
	'adminUsers',
	'authSessions',
	'otpChallenges',
	'oauthStates',
	'passwordResetTokens',
	'emailVerificationTokens',
	'adminInvites',
	'authRateLimits',
	'adminUserRoleAssignments',
] as const;

async function main(): Promise<void> {
	await connectMongo();
	try {
		const db = getMongoose().connection.db;
		if (!db) throw new Error('no db');
		for (const name of IDENTITY_COLLECTIONS) {
			const result = await db.collection(name).deleteMany({});
			console.log(`[wipe-identity] ${name} deleted=${result.deletedCount}`);
		}
	} finally {
		await disconnectMongo();
	}
}

main().catch((error: unknown) => {
	console.error('[wipe-identity] failed:', error);
	process.exitCode = 1;
});
