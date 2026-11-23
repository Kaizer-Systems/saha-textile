/**
 * Makes the service secrets one deployment tier needs: the database and Redis logins, the app's own
 * signing and encryption keys, and the four `/infrastructure` files. The same recipe serves the dev
 * project (the Mac's own Mongo, Redis and search server) and, later, staging and production.
 *
 * Every value comes from the operating system's secure random source (`crypto.randomBytes`), in the
 * forms the services document: hex for passwords and signing secrets (plain, so `sed`, Docker and
 * Compose read them unquoted), base64 for the replica-set keyfile and the 32-byte mailbox key.
 * Nothing here prints a value.
 */
import { randomBytes } from 'node:crypto';

/** The API's database login. A release creates it in the app's own database with `readWrite` only. */
export const APP_DATABASE_USER = 'saha_textile_app';

/** The database administrator, kept in `admin`, used only to create the app login and to back up. */
export const ROOT_DATABASE_USER = 'saha_textile_root';

/**
 * @param {'local' | 'development' | 'staging' | 'production'} tier
 * @param {(size: number) => Buffer} [random]
 * @returns {{ api: Map<string, string>, infrastructure: Map<string, string> }}
 */
export function generateServiceSecrets(tier, random = randomBytes) {
	const hex = (bytes) => random(bytes).toString('hex');
	return {
		api: new Map([
			['MONGODB_USERNAME', APP_DATABASE_USER],
			['MONGODB_PASSWORD', hex(32)],
			['REDIS_PASSWORD', hex(32)],
			// `openssl rand -hex 48`, as apps/api/.env.example asks.
			['JWT_ACCESS_SECRET', hex(48)],
			['JWT_REFRESH_SECRET', hex(48)],
			['CSRF_SECRET', hex(48)],
			// `openssl rand -base64 32`: the API refuses any other length.
			['MAILBOX_TOKEN_KEY', random(32).toString('base64')],
			// Seals the e-invoice and e-way bill paths' keys (accounts brief, 23 Nov): 32 bytes, base64.
			['EDOC_KEYS_KEY', random(32).toString('base64')],
		]),
		infrastructure: new Map([
			// `openssl rand -base64 756`: 1,008 base64 characters, inside MongoDB's 6 to 1,024.
			['mongo-keyfile', random(756).toString('base64')],
			['mongo-root-username', ROOT_DATABASE_USER],
			['mongo-root-password', hex(32)],
			// The Release Console's read-only database login (Release Path brief Q9).
			['mongo-monitor-password', hex(32)],
			[
				'meilisearch.toml',
				`master_key = "${hex(32)}"\nenv = "${tier === 'local' ? 'development' : 'production'}"\nno_analytics = true\n`,
			],
		]),
	};
}
