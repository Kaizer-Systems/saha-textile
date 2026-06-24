import { z } from 'zod';

/** Runtime configuration, validated once at boot from process.env. */
const ConfigSchema = z.object({
	nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
	port: z.coerce.number().int().positive().default(4000),
	corsAllowedOrigins: z
		.string()
		.default('http://localhost:3000,http://localhost:3001')
		.transform((s) =>
			s
				.split(',')
				.map((o) => o.trim())
				.filter(Boolean),
		),
	rateLimitMax: z.coerce.number().int().positive().default(100),
	rateLimitWindow: z.string().default('1 minute'),
	jwt: z.object({
		accessSecret: z.string().min(1),
		refreshSecret: z.string().min(1),
		accessTtl: z.string().default('15m'),
		refreshTtl: z.string().default('30d'),
	}),
	otp: z.object({
		ttlSeconds: z.coerce.number().int().positive().default(300),
		emailFrom: z.string().default('no-reply@sahatextile.com'),
		brevoApiKey: z.string().optional(),
	}),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
	return ConfigSchema.parse({
		nodeEnv: env.NODE_ENV,
		port: env.PORT,
		corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
		rateLimitMax: env.RATE_LIMIT_MAX,
		rateLimitWindow: env.RATE_LIMIT_WINDOW,
		jwt: {
			accessSecret: env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
			refreshSecret: env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me',
			accessTtl: env.JWT_ACCESS_TTL,
			refreshTtl: env.JWT_REFRESH_TTL,
		},
		otp: {
			ttlSeconds: env.OTP_TTL_SECONDS,
			emailFrom: env.OTP_EMAIL_FROM,
			brevoApiKey: env.BREVO_API_KEY,
		},
	});
}
