import { z } from 'zod';

/** Parses 'true'/'false' env strings into a real boolean (z.coerce.boolean would treat 'false' as true). */
const boolString = z
	.string()
	.default('false')
	.transform((v) => v === 'true' || v === '1');

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
		csrfHeader: z.string().default('x-csrf-token'),
		csrfSecret: z.string().optional(),
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
			csrfHeader: env.CSRF_HEADER_NAME,
			csrfSecret: env.CSRF_SECRET || undefined,
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
		otp: {
			ttlSeconds: env.OTP_TTL_SECONDS || undefined,
			maxAttempts: env.OTP_MAX_ATTEMPTS || undefined,
		},
	});
}
