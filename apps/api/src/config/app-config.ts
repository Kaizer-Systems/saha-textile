import { z } from 'zod';

/**
 * Parses 'true'/'false' env strings into a real boolean.
 *
 * `z.coerce.boolean()` cannot be used: it applies JavaScript truthiness, under which the
 * string `'false'` is `true` — so an operator disabling a flag would silently enable it.
 */
const boolStringWithDefault = (fallback: 'true' | 'false') =>
	z
		.string()
		.default(fallback)
		.transform((v) => v === 'true' || v === '1');

/** Opt-IN flag: absent means off. */
const boolString = boolStringWithDefault('false');

/** Opt-OUT flag: absent means on, so a forgotten variable fails closed rather than open. */
const secureBoolString = boolStringWithDefault('true');

/** Runtime configuration, validated once at boot from process.env. */
const ConfigSchema = z.object({
	nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
	port: z.coerce.number().int().positive().default(4000),
	corsAllowedOrigins: z
		.string()
		.default('http://localhost:4200,http://localhost:4300,http://127.0.0.1:3457,http://localhost:3457')
		.transform((s) =>
			s
				.split(',')
				.map((o) => o.trim())
				.filter(Boolean),
		),
	// Behind Cloudflare → Nginx in deploys: trust the proxy chain and read the
	// real client IP from CLIENT_IP_HEADER (cf-connecting-ip) for rate-limit/audit.
	trustProxy: boolString,
	clientIpHeader: z.string().optional(),
	/** Pino level for request/application logs. `silent` is used by tests. */
	logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
	rateLimitMax: z.coerce.number().int().positive().default(100),
	rateLimitWindow: z.string().default('1 minute'),
	// Transitional bearer JWT until Chunk D moves auth to httpOnly cookie sessions.
	jwt: z.object({
		accessSecret: z.string().min(1),
		refreshSecret: z.string().min(1),
		accessTtl: z.string().default('15m'),
		refreshTtl: z.string().default('30d'),
	}),
	// Cookie-session + double-submit CSRF placeholders; fully wired in Chunk D.
	cookies: z.object({
		domain: z.string().optional(),
		accessName: z.string().default('st_access'),
		refreshName: z.string().default('st_refresh'),
		csrfName: z.string().default('st_csrf'),
		guestName: z.string().default('st_guest'),
		/**
		 * Ties an in-progress signup to one browser before any account exists.
		 *
		 * Needed because the pending-signup record is the SERVER's memory of what has been
		 * proven, and it has to be findable without a session — there is no customer to
		 * authenticate yet. httpOnly like the rest: a script that could read it could resume
		 * somebody else's half-finished signup.
		 */
		signupName: z.string().default('st_signup'),
		csrfHeader: z.string().default('x-csrf-token'),
		csrfSecret: z.string().optional(),
		/**
		 * Whether session cookies carry `Secure` (and so may use the `__Host-` prefix).
		 *
		 * **Defaults to `true`, and that default is the point.** This used to be derived from
		 * `nodeEnv === 'production'`, which meant local development silently ran a second,
		 * weaker cookie model — no `Secure`, no `__Host-` — that no developer and no test
		 * ever exercised. Now local development serves TLS (`pnpm setup:local-https`) and
		 * gets the production attributes, so the two agree by default and opting out is an
		 * explicit, visible `COOKIE_SECURE=false`.
		 *
		 * It is deliberately NOT inferred from whether this process terminates TLS: in
		 * production Nginx does that, and the API speaks plain HTTP behind it while the
		 * browser is still on HTTPS. Only the browser-facing scheme matters here.
		 */
		secure: secureBoolString,
	}),
	/**
	 * Optional TLS for the API's own listener — local development only.
	 *
	 * Absent in deploys, where Nginx terminates TLS. Both must be set or neither; a
	 * half-configured pair is a configuration error rather than a silent downgrade.
	 */
	tls: z.object({
		certFile: z.string().optional(),
		keyFile: z.string().optional(),
	}),
	// MSG91 is the primary provider behind NotificationPort (SMS/WhatsApp/Email).
	// `console` logs instead of sending (local/test). Email fallback adapters are
	// optional and never primary.
	notifications: z.object({
		provider: z.enum(['console', 'msg91']).default('console'),
		msg91AuthKey: z.string().optional(),
		msg91SenderId: z.string().optional(),
		msg91EmailFrom: z.string().default('no-reply@sahatextile.com'),
		msg91EmailDomain: z.string().optional(),
		msg91WhatsappNumber: z.string().optional(),
		emailFallbackProvider: z.enum(['disabled', 'resend', 'ses', 'smtp']).default('disabled'),
		resendApiKey: z.string().optional(),
	}),
	/**
	 * Storefront social providers (`DEC-SIGNUP-VERIFICATION`).
	 *
	 * Every field optional, and that is deliberate: a provider is either fully configured or
	 * unavailable. A half-configured one must never half-work — the verifiers throw
	 * `OAuthProviderUnavailableError` rather than skipping a check they lack the material for.
	 *
	 * The client id and app id are PUBLIC and also reach the browser through `config.json`.
	 * The secrets are API-only and must never appear in a bundle, a log or a response.
	 * Admin has no social login and never will, so there is no admin equivalent here.
	 */
	oauth: z.object({
		googleClientId: z.string().optional(),
		googleClientSecret: z.string().optional(),
		facebookAppId: z.string().optional(),
		facebookAppSecret: z.string().optional(),
	}),
	otp: z.object({
		ttlSeconds: z.coerce.number().int().positive().default(600),
		maxAttempts: z.coerce.number().int().positive().default(5),
	}),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
	return ConfigSchema.parse({
		nodeEnv: env.NODE_ENV,
		port: env.PORT,
		corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
		trustProxy: env.TRUST_PROXY,
		clientIpHeader: env.CLIENT_IP_HEADER || undefined,
		logLevel: env.LOG_LEVEL || undefined,
		rateLimitMax: env.RATE_LIMIT_MAX,
		rateLimitWindow: env.RATE_LIMIT_WINDOW,
		jwt: {
			accessSecret: env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
			refreshSecret: env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me',
			accessTtl: env.JWT_ACCESS_TTL,
			refreshTtl: env.JWT_REFRESH_TTL,
		},
		cookies: {
			domain: env.COOKIE_DOMAIN || undefined,
			accessName: env.ACCESS_COOKIE_NAME,
			refreshName: env.REFRESH_COOKIE_NAME,
			csrfName: env.CSRF_COOKIE_NAME,
			guestName: env.GUEST_COOKIE_NAME,
			signupName: env.SIGNUP_COOKIE_NAME,
			csrfHeader: env.CSRF_HEADER_NAME,
			csrfSecret: env.CSRF_SECRET || undefined,
			secure: env.COOKIE_SECURE,
		},
		tls: {
			certFile: env.TLS_CERT_FILE || undefined,
			keyFile: env.TLS_KEY_FILE || undefined,
		},
		notifications: {
			provider: env.NOTIFICATION_PROVIDER || undefined,
			msg91AuthKey: env.MSG91_AUTH_KEY || undefined,
			msg91SenderId: env.MSG91_SENDER_ID || undefined,
			msg91EmailFrom: env.MSG91_EMAIL_FROM,
			msg91EmailDomain: env.MSG91_EMAIL_DOMAIN || undefined,
			msg91WhatsappNumber: env.MSG91_WHATSAPP_NUMBER || undefined,
			emailFallbackProvider: env.EMAIL_FALLBACK_PROVIDER || undefined,
			resendApiKey: env.RESEND_API_KEY || undefined,
		},
		oauth: {
			googleClientId: env.GOOGLE_OAUTH_CLIENT_ID || undefined,
			googleClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET || undefined,
			facebookAppId: env.FACEBOOK_OAUTH_APP_ID || undefined,
			facebookAppSecret: env.FACEBOOK_OAUTH_APP_SECRET || undefined,
		},
		otp: {
			ttlSeconds: env.OTP_TTL_SECONDS || undefined,
			maxAttempts: env.OTP_MAX_ATTEMPTS || undefined,
		},
	});
}
