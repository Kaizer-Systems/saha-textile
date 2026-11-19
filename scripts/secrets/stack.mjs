/**
 * Mode 3, the full local Docker stack (`pnpm stack:env`): writes `docker/stack/env/` from the dev
 * project, so the stack reads its secrets the way a droplet does (plan step 5, 2026-11-19).
 *
 *   api.env            the dev project's /api settings with the stack's own on top; mounted
 *                      read-only at /run/secrets/api.env and read through DOTENV_CONFIG_PATH
 *   redis-password     Redis reads it from a file at start, as on a droplet
 *   meilisearch.toml   the search server's master key, as on a droplet
 *   storefront.env, storefront.config.json, admin.config.json   public settings, no secrets
 *
 * The stack's Redis password and search key are made on this Mac the first time and kept in
 * `stack.env`: they guard services only this Mac can reach, so they have no place in Infisical.
 * When Infisical cannot be read, `apps/api/.env` (which `pnpm secrets:pull` keeps in step) is used.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { parseEnvText, readIfPresent, replaceFile } from './files.mjs';
import { SecretsError } from './inventory.mjs';
import { buildStackEnv, isBlank, isPlain } from './render.mjs';

export const STACK_ENV_DIR = 'docker/stack/env';

const STOREFRONT_HOST = 'local.saha-textile.localhost';
const ADMIN_HOST = 'admin-local.saha-textile.localhost';
const API_HOST = 'api-local.saha-textile.localhost';

/**
 * Settings the stack sets itself. The dev project's values for these describe `pnpm dev` on this Mac
 * (localhost ports, the local database, the fixed sign-in code), never the stack. SHOP_ORIGIN points
 * at the dev shop on localhost:4200, which a container cannot reach, so the stack leaves it unset.
 */
export const STACK_OWNED =
	/^(NODE_ENV|DEPLOY_ENV|PORT|CORS_ALLOWED_ORIGINS|TRUST_PROXY|CLIENT_IP_HEADER|MONGODB_[A-Z_]+|REDIS_[A-Z_]+|MEILISEARCH_HOST|MEILISEARCH_API_KEY|COOKIE_DOMAIN|COOKIE_SECURE|TLS_CERT_FILE|TLS_KEY_FILE|OTP_LOCAL_FIXED_CODE|ADMIN_APP_URL|GOOGLE_MAIL_REDIRECT_URI|SHOP_ORIGIN)$/;

/** Values made on this Mac once and kept in `stack.env`. */
export const LOCAL_SECRETS = ['REDIS_PASSWORD', 'MEILISEARCH_MASTER_KEY'];

/**
 * `stack.env` with any missing local secret added. Lines already there are kept as they are.
 * @param {string | null} text
 * @param {() => string} [makeSecret]
 */
export function completeStackEnv(text, makeSecret = () => randomBytes(24).toString('hex')) {
	const values = text === null ? new Map() : parseEnvText(text);
	let next = text ?? '';
	if (next !== '' && !next.endsWith('\n')) next += '\n';
	for (const name of LOCAL_SECRETS) {
		if (values.get(name)) continue;
		const value = makeSecret();
		values.set(name, value);
		next += `${name}=${value}\n`;
	}
	for (const name of LOCAL_SECRETS) {
		if (!isPlain(/** @type {string} */ (values.get(name)))) {
			throw new SecretsError(
				`${name} in ${STACK_ENV_DIR}/stack.env may not contain a space, quote, #, backslash or $.`,
			);
		}
	}
	return { text: next, values };
}

/** @param {Map<string, string>} local  the values in `stack.env` */
export function stackPort(local) {
	const port = local.get('STACK_HTTPS_PORT') || '443';
	if (!/^[0-9]{1,5}$/.test(port))
		throw new SecretsError(`STACK_HTTPS_PORT in ${STACK_ENV_DIR}/stack.env must be a port number.`);
	return port;
}

/**
 * Every file of `docker/stack/env/` apart from `stack.env`, keyed by file name.
 * @param {Map<string, string>} api      the dev project's /api folder, or apps/api/.env as a fallback
 * @param {object} options
 * @param {import('./inventory.mjs').Inventory} options.inventory
 * @param {string} options.source
 * @param {Map<string, string>} options.local    the values in `stack.env`, local secrets included
 * @param {'refuse' | 'drop'} options.unknown
 */
export function buildStackFiles(api, { inventory, source, local, unknown }) {
	const port = stackPort(local);
	const suffix = port === '443' ? '' : `:${port}`;
	const shop = `https://${STOREFRONT_HOST}${suffix}`;
	const admin = `https://${ADMIN_HOST}${suffix}`;
	const apiUrl = `https://${API_HOST}${suffix}`;
	const redisPassword = /** @type {string} */ (local.get('REDIS_PASSWORD'));
	const searchKey = /** @type {string} */ (local.get('MEILISEARCH_MASTER_KEY'));

	const settings = new Map([
		['NODE_ENV', 'production'],
		['DEPLOY_ENV', 'local'],
		['PORT', '4000'],
		['MONGODB_HOST', 'mongo'],
		['MONGODB_PORT', '27017'],
		['MONGODB_REPLICA_SET', 'rs0'],
		['MONGODB_DB_NAME', 'saha_textile_stack'],
		['REDIS_HOST', 'redis'],
		['REDIS_PORT', '6379'],
		['REDIS_PASSWORD', redisPassword],
		['MEILISEARCH_HOST', 'http://meilisearch:7700'],
		['MEILISEARCH_API_KEY', searchKey],
		['CORS_ALLOWED_ORIGINS', `${shop},${admin}`],
		['TRUST_PROXY', 'true'],
		['CLIENT_IP_HEADER', 'cf-connecting-ip'],
		['COOKIE_SECURE', 'true'],
		['ADMIN_APP_URL', admin],
		// Google refuses .localhost callbacks, so the stack reuses the dev client's registered one.
		['GOOGLE_MAIL_REDIRECT_URI', 'https://localhost:4000/admin/mailboxes/oauth/callback'],
	]);
	const env = buildStackEnv(api, { inventory, source, owned: STACK_OWNED, settings, unknown });

	const storefrontConfig = {
		apiUrl,
		siteUrl: shop,
		defaultLocale: 'en',
		googleClientId: api.get('GOOGLE_OAUTH_CLIENT_ID') ?? '',
		facebookAppId: api.get('FACEBOOK_OAUTH_APP_ID') ?? '',
	};
	const files = new Map([
		['api.env', env.text],
		['redis-password', redisPassword],
		['meilisearch.toml', `master_key = "${searchKey}"\nenv = "development"\nno_analytics = true\n`],
		['storefront.config.json', `${JSON.stringify(storefrontConfig, null, '\t')}\n`],
		[
			'storefront.env',
			[
				'# Written by pnpm stack:env. Public settings only, no secrets.',
				`SAHA_TEXTILE_PUBLIC_CONFIG=${JSON.stringify(storefrontConfig)}`,
				'NODE_EXTRA_CA_CERTS=/certs/rootCA.pem',
				'',
			].join('\n'),
		],
		['admin.config.json', `${JSON.stringify({ apiUrl, adminUrl: admin, siteUrl: shop }, null, '\t')}\n`],
	]);
	return { files, notes: env.notes, names: env.names, hosts: { shop, admin, api: apiUrl } };
}

/** The files that hold secrets; the rest are public. */
const SECRET_FILES = new Set(['api.env', 'redis-password', 'meilisearch.toml', 'stack.env']);

/**
 * Reads Infisical (or the fallback), writes `docker/stack/env/`, and returns what to print.
 * @param {object} options
 * @param {string} options.root
 * @param {import('./inventory.mjs').Inventory} options.inventory
 * @param {() => Map<string, string>} options.readApi
 * @param {() => string} [options.makeSecret]
 * @returns {string[]}
 */
export function writeStackEnv({ root, inventory, readApi, makeSecret }) {
	const project = inventory.projects.dev;
	const lines = [];
	let api;
	let source = `Infisical ${project.name} (${project.environment}), folder /api`;
	let unknown = /** @type {'refuse' | 'drop'} */ ('refuse');
	try {
		api = readApi();
	} catch (error) {
		if (!(error instanceof SecretsError)) throw error;
		const fallback = readIfPresent(join(root, 'apps/api/.env'));
		if (fallback === null) {
			throw new SecretsError(
				`${error.message}\nThere is no apps/api/.env to fall back on either. Nothing was written.`,
			);
		}
		lines.push('Infisical could not be read, so apps/api/.env was used instead:', `  ${error.message}`);
		api = parseEnvText(fallback);
		source = 'apps/api/.env (Infisical could not be read)';
		unknown = 'drop';
	}

	const dir = join(root, STACK_ENV_DIR);
	const stackEnvPath = join(dir, 'stack.env');
	const local = completeStackEnv(readIfPresent(stackEnvPath), makeSecret);
	const built = buildStackFiles(api, { inventory, source, local: local.values, unknown });
	// Settings the last api.env had and this one lacks: most often values not yet filled in Infisical.
	const previous = readIfPresent(join(dir, 'api.env'));
	const dropped =
		previous === null
			? []
			: [...parseEnvText(previous)]
					.filter(([name, value]) => !isBlank(value) && !built.names.includes(name))
					.map(([name]) => name)
					.sort();

	mkdirSync(dir, { recursive: true, mode: 0o700 });
	replaceFile(stackEnvPath, local.text, 0o600);
	for (const [name, text] of built.files) replaceFile(join(dir, name), text, SECRET_FILES.has(name) ? 0o600 : 0o644);

	lines.push(
		`Wrote ${STACK_ENV_DIR}: api.env (${built.names.length} settings from ${source}), redis-password, meilisearch.toml, storefront.env and the two config.json files.`,
		...built.notes.map((note) => `  ${note}`),
		...(dropped.length > 0
			? [
					`  No longer in api.env: ${dropped.join(', ')}. Fill any the stack needs in Infisical, then run pnpm stack:env again.`,
				]
			: []),
		`Safari only, add to /etc/hosts:  127.0.0.1 ${STOREFRONT_HOST} ${ADMIN_HOST} ${API_HOST}`,
	);
	return lines;
}
