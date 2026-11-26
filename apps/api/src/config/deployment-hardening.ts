import type { AppConfig } from './app-config';

/**
 * Where this process runs (`DEPLOY_ENV`). Separate from `NODE_ENV`, which says how the code was
 * BUILT: the local mode-3 Docker stack runs production builds (`NODE_ENV=production`) on a
 * laptop with development secrets, and has to keep booting.
 */
export const DEPLOY_ENVS = ['local', 'development', 'staging', 'production'] as const;
export type DeployEnv = (typeof DEPLOY_ENVS)[number];

/**
 * Whether the deployment hardening rules apply (owner choice 2026-11-03).
 *
 * Strict by default: a production build is held to deployment rules unless the operator says,
 * explicitly, `DEPLOY_ENV=local`. A forgotten variable therefore fails closed — a deploy that
 * omits `DEPLOY_ENV` is treated as production, never as a laptop. Staging is as strict as
 * production: it has its own real credentials under the three-environment plan. So is a
 * development server (`development`, owner 2026-11-21): a server is a server.
 */
export function isStrictDeployment(config: Pick<AppConfig, 'nodeEnv' | 'deployEnv'>): boolean {
	if (isServerEnv(config.deployEnv)) return true;
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
const MIN_SEARCH_KEY_LENGTH = 16;
const PLACEHOLDER_MARKERS = ['change-me', 'change_me', 'changeme', 'replace', 'placeholder', 'example', 'dev-'];

/** Hosts that only ever mean "this machine" — never a real browser origin in a deployment. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

const CCAVENUE_TEST_HOSTS = new Set(['test.ccavenue.com', 'apitest.ccavenue.com']);

/**
 * Provider keys a server may be deployed without, on purpose, so it can come up for browsing before
 * the key exists (owner, 2026-11-21: the Release Console's "deploy with these blank"). The release
 * names the ones it left blank in `RELEASE_ALLOWED_BLANK`; then the API starts, and the service
 * refuses its own work instead (no message sent, no upload). Must equal the names tagged
 * `may-deploy-blank` in `docker/production/required-secrets.txt` (a test keeps the two in step).
 * Start-up secrets, the browser boundary, the proxy and the data stores are never on this list.
 */
export const MAY_DEPLOY_BLANK = ['MSG91_AUTH_KEY', 'SPACES_KEY', 'SPACES_SECRET', 'SPACES_BUCKET'] as const;

const SPACES_KEYS = ['SPACES_KEY', 'SPACES_SECRET', 'SPACES_BUCKET'] as const;

/**
 * The names in `RELEASE_ALLOWED_BLANK` (written by the release, never by hand), and a problem when
 * it names anything outside {@link MAY_DEPLOY_BLANK}. The message never repeats the variable's text.
 */
export function releaseAllowedBlank(env: NodeJS.ProcessEnv): { names: Set<string>; problems: string[] } {
	const names = new Set(
		(env.RELEASE_ALLOWED_BLANK ?? '')
			.split(',')
			.map((name) => name.trim())
			.filter(Boolean),
	);
	const allowed = new Set<string>(MAY_DEPLOY_BLANK);
	const problems = [...names].some((name) => !allowed.has(name))
		? [`RELEASE_ALLOWED_BLANK may name only ${MAY_DEPLOY_BLANK.join(', ')}.`]
		: [];
	return { names, problems };
}

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
	if (isServerEnv(config.deployEnv) && config.nodeEnv !== 'production') {
		problems.push(`DEPLOY_ENV=${config.deployEnv} requires NODE_ENV=production.`);
	}
	if (!isStrictDeployment(config)) return problems;

	// Provider keys this server was deployed without on purpose (`--allow-blank`).
	const blank = releaseAllowedBlank(env);
	problems.push(...blank.problems);

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
	// The keys kept for 30 days after a planned change (Release Path brief): as strong as the rest,
	// and never one of the current ones.
	for (const name of ['JWT_ACCESS_SECRET_PREVIOUS', 'JWT_REFRESH_SECRET_PREVIOUS', 'CSRF_SECRET_PREVIOUS']) {
		const value = env[name];
		if (!value) continue;
		const problem = secretProblem(name, value);
		if (problem) problems.push(problem);
		secrets.push({ name, value });
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
	} else if (!config.notifications.msg91AuthKey && !blank.names.has('MSG91_AUTH_KEY')) {
		// Unless the release left it blank on purpose, a missing key is a mistake: every one-time
		// code would silently fail. Left blank on purpose, the composition root uses a sender that
		// refuses every message and records it as failed (`UnavailableNotificationAdapter`).
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
	if (!config.search.host) {
		problems.push('MEILISEARCH_HOST must be set: without it search and typeahead stop working.');
	}
	problems.push(...searchKeyProblems(env.MEILISEARCH_API_KEY));
	// A half-configured store is refused while parsing, so unconfigured here means all three blank.
	// Left blank on purpose, the unconfigured storage adapter refuses every media call.
	if (!config.spaces.configured && !SPACES_KEYS.every((name) => blank.names.has(name))) {
		problems.push('Media storage must be configured: set SPACES_KEY, SPACES_SECRET and SPACES_BUCKET.');
	}
	if (!config.spaces.cdnUrl) {
		problems.push('SPACES_CDN_URL must be set to the https CDN host that serves media.');
	} else if (!config.spaces.cdnUrl.startsWith('https://')) {
		problems.push('SPACES_CDN_URL must be an https URL.');
	}

	// --- Release Console reads (optional: blank switches the address off) --------------------
	if (env.OPS_TOKEN) {
		const problem = secretProblem('OPS_TOKEN', env.OPS_TOKEN);
		if (problem) problems.push(problem);
	}
	if (env.MSG91_RECEIPT_TOKEN) problems.push(...receiptTokenProblems(env.MSG91_RECEIPT_TOKEN));

	// --- Payments ---------------------------------------------------------------------------
	problems.push(...ccavenueHostProblems(config));

	return problems;
}

/**
 * The three-environment plan: staging and a development server take test payments only, and
 * production takes real ones only. Applies once CCAvenue is configured, because a deployment may
 * run before it is.
 */
function ccavenueHostProblems(config: AppConfig): string[] {
	const { ccavenue } = config.payments;
	if (!ccavenue.configured) return [];
	const testOnly = config.deployEnv === 'staging' || config.deployEnv === 'development';
	return [
		{ name: 'CCAVENUE_BASE_URL', url: ccavenue.baseUrl },
		{ name: 'CCAVENUE_API_URL', url: ccavenue.apiUrl },
	].flatMap(({ name, url }) => {
		const isTestHost = CCAVENUE_TEST_HOSTS.has(new URL(url).hostname);
		if (testOnly && !isTestHost) return [`${name} must be a CCAvenue test host on ${config.deployEnv}.`];
		if (!testOnly && isTestHost) return [`${name} must not be a CCAvenue test host in production.`];
		return [];
	});
}

/** A server environment: a development server, staging or production (never this computer). */
function isServerEnv(deployEnv: DeployEnv | undefined): boolean {
	return deployEnv === 'development' || deployEnv === 'staging' || deployEnv === 'production';
}

/** Meilisearch itself refuses a production master key under 16 bytes, so the API key gets the same floor. */
function searchKeyProblems(key: string | undefined): string[] {
	if (!key) return ['MEILISEARCH_API_KEY must be set: a production search server refuses unsigned requests.'];
	const lower = key.toLowerCase();
	if (lower.startsWith('local-') || PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker))) {
		return ['MEILISEARCH_API_KEY looks like a local or placeholder value.'];
	}
	if (key.length < MIN_SEARCH_KEY_LENGTH) {
		return [`MEILISEARCH_API_KEY must be at least ${MIN_SEARCH_KEY_LENGTH} characters.`];
	}
	return [];
}

/** MSG91 puts this in an address, so it is shorter than a signing secret: `openssl rand -hex 24` and up. */
const MIN_RECEIPT_TOKEN_LENGTH = 48;

function receiptTokenProblems(value: string): string[] {
	const lower = value.toLowerCase();
	if (PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker))) {
		return ['MSG91_RECEIPT_TOKEN looks like a placeholder; generate one with `openssl rand -hex 24`.'];
	}
	if (value.length < MIN_RECEIPT_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
		return [
			`MSG91_RECEIPT_TOKEN must be at least ${MIN_RECEIPT_TOKEN_LENGTH} letters or digits; generate one with \`openssl rand -hex 24\`.`,
		];
	}
	if (new Set(value).size < MIN_DISTINCT_SECRET_CHARACTERS) {
		return ['MSG91_RECEIPT_TOKEN is too repetitive to be random; generate one with `openssl rand -hex 24`.'];
	}
	return [];
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
