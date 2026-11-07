import type { AppConfig } from './app-config';

/**
 * Where this process runs (`DEPLOY_ENV`). Separate from `NODE_ENV`, which says how the code was
 * BUILT: the local mode-3 Docker stack runs production builds (`NODE_ENV=production`) on a
 * laptop with development secrets, and has to keep booting.
 */
export const DEPLOY_ENVS = ['local', 'staging', 'production'] as const;
export type DeployEnv = (typeof DEPLOY_ENVS)[number];

/**
 * Whether the deployment hardening rules apply (owner choice 2026-11-03).
 *
 * Strict by default: a production build is held to deployment rules unless the operator says,
 * explicitly, `DEPLOY_ENV=local`. A forgotten variable therefore fails closed — a deploy that
 * omits `DEPLOY_ENV` is treated as production, never as a laptop. Staging is as strict as
 * production: it has its own real credentials under the three-environment plan.
 */
export function isStrictDeployment(config: Pick<AppConfig, 'nodeEnv' | 'deployEnv'>): boolean {
	if (config.deployEnv === 'staging' || config.deployEnv === 'production') return true;
	return config.nodeEnv === 'production' && config.deployEnv !== 'local';
}

/** Shortest secret accepted in a strict deployment: `openssl rand -hex 32` and up. */
export const MIN_SECRET_LENGTH = 64;

/**
 * Fewest distinct characters a strict secret may contain. Random hex of 64+ characters carries
 * all sixteen digits with near certainty; a value like `aaaa…` or `abababab…` does not.
 */
const MIN_DISTINCT_SECRET_CHARACTERS = 12;

/** Words that mark a value as a placeholder somebody meant to replace. Compared lower-case. */
const PLACEHOLDER_MARKERS = ['change-me', 'change_me', 'changeme', 'replace', 'placeholder', 'example', 'dev-'];

/** Hosts that only ever mean "this machine" — never a real browser origin in a deployment. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

/**
 * Raised at boot when a strict deployment is misconfigured.
 *
 * Lists EVERY problem at once, so an operator fixes the env file in one pass instead of
 * discovering the rules one restart at a time. The messages name variables and rules only —
 * never a value — because boot errors end up in container logs.
 */
export class DeploymentConfigError extends Error {
	constructor(readonly problems: string[]) {
		super(
			`Refusing to start: this is a strict deployment (DEPLOY_ENV/NODE_ENV) and its configuration ` +
				`is unsafe:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`,
		);
		this.name = 'DeploymentConfigError';
	}
}

/**
 * Every reason this configuration must not run as a deployment; empty when it may.
 *
 * Takes the RAW environment as well as the parsed config, for two reasons: the parsed JWT
 * secrets have already had their development fallbacks applied, so only the raw env can say
 * whether a secret was actually SET; and the Mongo credentials belong to the persistence
 * adapter's own config, which the API does not parse.
 */
export function deploymentHardeningProblems(config: AppConfig, env: NodeJS.ProcessEnv): string[] {
	const problems: string[] = [];

	// A deployment label on a development build is a broken deploy, not a choice.
	if ((config.deployEnv === 'staging' || config.deployEnv === 'production') && config.nodeEnv !== 'production') {
		problems.push(`DEPLOY_ENV=${config.deployEnv} requires NODE_ENV=production.`);
	}
	if (!isStrictDeployment(config)) return problems;

	// --- Secrets ---------------------------------------------------------------------------
	const secrets = [
		{ name: 'JWT_ACCESS_SECRET', value: env.JWT_ACCESS_SECRET },
		{ name: 'JWT_REFRESH_SECRET', value: env.JWT_REFRESH_SECRET },
		// Without its own secret, CSRF tokens and every stored hash (OTP, reset, guest cart) are
		// peppered with the refresh-token signing key — one leak would then open both.
		{ name: 'CSRF_SECRET', value: env.CSRF_SECRET },
	];
	for (const { name, value } of secrets) {
		const problem = secretProblem(name, value);
		if (problem) problems.push(problem);
	}
	for (let i = 0; i < secrets.length; i++) {
		for (let j = i + 1; j < secrets.length; j++) {
			const [a, b] = [secrets[i]!, secrets[j]!];
			if (a.value && b.value && a.value === b.value) {
				problems.push(`${a.name} and ${b.name} must be different secrets.`);
			}
		}
	}

	// --- Browser boundary ------------------------------------------------------------------
	if (!config.cookies.secure) {
		problems.push('COOKIE_SECURE must be true: deployed session cookies need Secure and the __Host- prefix.');
	}
	if (!env.CORS_ALLOWED_ORIGINS) {
		problems.push('CORS_ALLOWED_ORIGINS must be set: the built-in default only lists localhost origins.');
	} else {
		for (const origin of config.corsAllowedOrigins) {
			const problem = originProblem(origin);
			if (problem) problems.push(problem);
		}
	}

	// --- Client identity behind Cloudflare and Nginx ---------------------------------------
	if (!config.trustProxy) {
		problems.push(
			'TRUST_PROXY must be true behind Cloudflare and Nginx, or every visitor shares one rate-limit bucket.',
		);
	}
	if (!config.clientIpHeader) {
		problems.push('CLIENT_IP_HEADER must be set (cf-connecting-ip), or audit rows record the proxy address.');
	}

	// --- Delivery and one-time codes -------------------------------------------------------
	if (config.notifications.provider !== 'msg91') {
		problems.push('NOTIFICATION_PROVIDER must be msg91: the console provider only logs codes and links.');
	} else if (!config.notifications.msg91AuthKey) {
		// The composition root falls back to the console adapter here — fine on a laptop, a silent
		// outage of every one-time code in a deployment.
		problems.push('MSG91_AUTH_KEY must be set when NOTIFICATION_PROVIDER=msg91.');
	}
	if (config.otp.localFixedCode) {
		problems.push('OTP_LOCAL_FIXED_CODE must not be set: it makes every one-time code guessable.');
	}

	// --- Social sign-in --------------------------------------------------------------------
	if (Boolean(config.oauth.facebookAppId) !== Boolean(config.oauth.facebookAppSecret)) {
		problems.push('Set both FACEBOOK_OAUTH_APP_ID and FACEBOOK_OAUTH_APP_SECRET, or neither.');
	}

	// --- Data stores ------------------------------------------------------------------------
	if (!mongoHasCredentials(env)) {
		problems.push(
			'MongoDB must authenticate: set MONGODB_USERNAME and MONGODB_PASSWORD, or a MONGODB_URI with credentials.',
		);
	}
	if (!config.redis.password) {
		problems.push('REDIS_PASSWORD must be set: the media job queue must not run open.');
	}
	if (!config.spaces.configured) {
		problems.push('Media storage must be configured: set SPACES_KEY, SPACES_SECRET and SPACES_BUCKET.');
	}
	if (!config.spaces.cdnUrl) {
		problems.push('SPACES_CDN_URL must be set to the https CDN host that serves media.');
	} else if (!config.spaces.cdnUrl.startsWith('https://')) {
		problems.push('SPACES_CDN_URL must be an https URL.');
	}

	return problems;
}

function secretProblem(name: string, value: string | undefined): string | null {
	if (!value) return `${name} must be set; a deployment never falls back to a built-in development value.`;
	const lower = value.toLowerCase();
	if (PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker))) {
		return `${name} looks like a placeholder; generate one with \`openssl rand -hex 48\`.`;
	}
	if (value.length < MIN_SECRET_LENGTH) {
		return `${name} must be at least ${MIN_SECRET_LENGTH} characters; generate one with \`openssl rand -hex 48\`.`;
	}
	if (new Set(value).size < MIN_DISTINCT_SECRET_CHARACTERS) {
		return `${name} is too repetitive to be random; generate one with \`openssl rand -hex 48\`.`;
	}
	return null;
}

/** The origin is echoed back: it is public configuration, unlike a secret. */
function originProblem(origin: string): string | null {
	if (origin.includes('*')) return `CORS_ALLOWED_ORIGINS must list exact origins, not a wildcard (${origin}).`;
	if (!URL.canParse(origin)) return `CORS_ALLOWED_ORIGINS has an entry that is not a URL (${origin}).`;
	const url = new URL(origin);
	if (url.protocol !== 'https:') return `CORS_ALLOWED_ORIGINS must use https (${origin}).`;
	const host = url.hostname.toLowerCase();
	if (LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost')) {
		return `CORS_ALLOWED_ORIGINS must not include a local origin (${origin}).`;
	}
	return null;
}

/**
 * Read with a pattern rather than `URL`: a replica-set URI lists several hosts
 * (`mongodb://user:pass@mongo-1:27017,mongo-2:27017/db`), which is valid to the driver and
 * unparseable as a WHATWG URL — so `URL` refused exactly the URIs a deployment uses.
 */
const MONGO_URI_CREDENTIALS = /^mongodb(?:\+srv)?:\/\/[^:@/]+:[^@/]+@/;

function mongoHasCredentials(env: NodeJS.ProcessEnv): boolean {
	if (env.MONGODB_URI) return MONGO_URI_CREDENTIALS.test(env.MONGODB_URI);
	return Boolean(env.MONGODB_USERNAME && env.MONGODB_PASSWORD);
}
