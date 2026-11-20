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
 *   mongo-keyfile, mongo-root-username, mongo-root-password, mongo-app-password
 *                      the stack's MongoDB requires logins, as on a droplet
 *
 * The stack's Redis password, search master key and database logins are the dev project's own
 * (`/api/REDIS_PASSWORD`, `/api/MONGODB_USERNAME` and `MONGODB_PASSWORD`, and the `/infrastructure`
 * files), as the owner directed on 2026-11-20: `pnpm dev` uses the stack's search server, so both
 * modes must agree on its key. `stack.env` keeps only this Mac's HTTPS port. When Infisical cannot
 * be read, `apps/api/.env` (which `pnpm secrets:pull` keeps in step) and `docker/dev-secrets/` are
 * used.
 */
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

/** Lines an older `stack.env` held. The stack now takes both from the dev project and ignores them. */
export const RETIRED_LOCAL_SECRETS = ['REDIS_PASSWORD', 'MEILISEARCH_MASTER_KEY'];

/** The `/infrastructure` files the stack reads; `docker/dev-secrets/` holds the same as a fallback. */
export const STACK_INFRASTRUCTURE_FILES = [
	'mongo-keyfile',
	'mongo-root-username',
	'mongo-root-password',
	'meilisearch.toml',
];

/**
 * The stack's Redis password, search server settings and database logins, from the dev project.
 * @param {Map<string, string>} api              the dev project's /api folder (or apps/api/.env)
 * @param {Map<string, string>} infrastructure   its /infrastructure folder (or docker/dev-secrets/)
 * @param {string} source                         where they came from, for messages
 */
export function stackServiceSecrets(api, infrastructure, source) {
	const searchConfig = infrastructure.get('meilisearch.toml');
	for (const name of ['REDIS_PASSWORD', 'MONGODB_USERNAME', 'MONGODB_PASSWORD']) {
		if (isBlank(api.get(name))) throw new SecretsError(`${name} is blank in ${source}. Nothing was written.`);
	}
	for (const name of ['mongo-keyfile', 'mongo-root-username', 'mongo-root-password']) {
		if (isBlank(infrastructure.get(name))) {
			throw new SecretsError(
				`${name} is blank in the dev project's /infrastructure folder. Nothing was written.`,
			);
		}
	}
	const redisPassword = /** @type {string} */ (api.get('REDIS_PASSWORD'));
	const keyfile = /** @type {string} */ (infrastructure.get('mongo-keyfile')).replace(/\s/g, '');
	if (!/^[A-Za-z0-9+/=]{6,1024}$/.test(keyfile)) {
		throw new SecretsError(
			'mongo-keyfile must be 6 to 1,024 base64 characters, as made by: openssl rand -base64 756. Nothing was written.',
		);
	}
	const mongo = {
		keyfile: `${keyfile}\n`,
		rootUser: /** @type {string} */ (infrastructure.get('mongo-root-username')).trim(),
		rootPassword: /** @type {string} */ (infrastructure.get('mongo-root-password')).trim(),
		appUser: /** @type {string} */ (api.get('MONGODB_USERNAME')),
		appPassword: /** @type {string} */ (api.get('MONGODB_PASSWORD')),
	};
	const masterKey = /^\s*master_key\s*=\s*"([^"]+)"\s*$/m.exec(searchConfig ?? '')?.[1] ?? '';
	if (masterKey === '') {
		throw new SecretsError(
			`meilisearch.toml has no master_key (dev project /infrastructure). Nothing was written.`,
		);
	}
	for (const [name, value] of [
		['REDIS_PASSWORD', redisPassword],
		['the search master key', masterKey],
		['mongo-root-username', mongo.rootUser],
		['mongo-root-password', mongo.rootPassword],
		['MONGODB_USERNAME', mongo.appUser],
		['MONGODB_PASSWORD', mongo.appPassword],
	]) {
		if (!isPlain(value)) {
			throw new SecretsError(`${name} may not contain a space, quote, #, backslash or $. Nothing was written.`);
		}
	}
	const text = /** @type {string} */ (searchConfig);
	return { redisPassword, masterKey, searchConfig: text.endsWith('\n') ? text : `${text}\n`, mongo };
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
 * @param {Map<string, string>} options.local    the values in `stack.env`
 * @param {ReturnType<typeof stackServiceSecrets>} options.services
 * @param {'refuse' | 'drop'} options.unknown
 */
export function buildStackFiles(api, { inventory, source, local, services, unknown }) {
	const port = stackPort(local);
	const suffix = port === '443' ? '' : `:${port}`;
	const shop = `https://${STOREFRONT_HOST}${suffix}`;
	const admin = `https://${ADMIN_HOST}${suffix}`;
	const apiUrl = `https://${API_HOST}${suffix}`;
	const redisPassword = services.redisPassword;
	const searchKey = services.masterKey;

	const settings = new Map([
		['NODE_ENV', 'production'],
		['DEPLOY_ENV', 'local'],
		['PORT', '4000'],
		['MONGODB_HOST', 'mongo'],
		['MONGODB_PORT', '27017'],
		['MONGODB_REPLICA_SET', 'rs0'],
		['MONGODB_DB_NAME', 'saha_textile_stack'],
		['MONGODB_USERNAME', services.mongo.appUser],
		['MONGODB_PASSWORD', services.mongo.appPassword],
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
		['meilisearch.toml', services.searchConfig],
		['mongo-keyfile', services.mongo.keyfile],
		['mongo-root-username', services.mongo.rootUser],
		['mongo-root-password', services.mongo.rootPassword],
		['mongo-app-password', services.mongo.appPassword],
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
const SECRET_FILES = new Set([
	'api.env',
	'redis-password',
	'meilisearch.toml',
	'mongo-keyfile',
	'mongo-root-username',
	'mongo-root-password',
	'mongo-app-password',
	'stack.env',
]);

/**
 * Reads Infisical (or the fallback), writes `docker/stack/env/`, and returns what to print.
 * @param {object} options
 * @param {string} options.root
 * @param {import('./inventory.mjs').Inventory} options.inventory
 * @param {() => Map<string, string>} options.readApi
 * @param {() => Map<string, string>} options.readInfrastructure
 * @returns {string[]}
 */
export function writeStackEnv({ root, inventory, readApi, readInfrastructure }) {
	const project = inventory.projects.dev;
	const lines = [];
	let api;
	let infrastructure;
	let source = `Infisical ${project.name} (${project.environment}), folder /api`;
	let unknown = /** @type {'refuse' | 'drop'} */ ('refuse');
	try {
		api = readApi();
		infrastructure = readInfrastructure();
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
		infrastructure = new Map(
			STACK_INFRASTRUCTURE_FILES.map((name) => [
				name,
				readIfPresent(join(root, 'docker/dev-secrets', name)) ?? '',
			]),
		);
		source = 'apps/api/.env (Infisical could not be read)';
		unknown = 'drop';
	}

	const dir = join(root, STACK_ENV_DIR);
	const stackEnvPath = join(dir, 'stack.env');
	const localText = readIfPresent(stackEnvPath);
	const local = localText === null ? new Map() : parseEnvText(localText);
	const services = stackServiceSecrets(api, infrastructure, source);
	const built = buildStackFiles(api, { inventory, source, local, services, unknown });
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
	for (const [name, text] of built.files) replaceFile(join(dir, name), text, SECRET_FILES.has(name) ? 0o600 : 0o644);

	lines.push(
		`Wrote ${STACK_ENV_DIR}: api.env (${built.names.length} settings from ${source}), redis-password, meilisearch.toml, the four MongoDB login files, storefront.env and the two config.json files.`,
		...built.notes.map((note) => `  ${note}`),
		...(dropped.length > 0
			? [
					`  No longer in api.env: ${dropped.join(', ')}. Fill any the stack needs in Infisical, then run pnpm stack:env again.`,
				]
			: []),
		`Safari only, add to /etc/hosts:  127.0.0.1 ${STOREFRONT_HOST} ${ADMIN_HOST} ${API_HOST}`,
	);
	const retired = RETIRED_LOCAL_SECRETS.filter((name) => local.has(name));
	if (retired.length > 0) {
		lines.push(
			`  ${STACK_ENV_DIR}/stack.env still holds ${retired.join(' and ')}, no longer used: the stack takes ${retired.length > 1 ? 'both' : 'it'} from the dev project. Only STACK_HTTPS_PORT is read there.`,
		);
	}
	return lines;
}
