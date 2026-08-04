import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { REQUEST_ID_HEADER, resolveClientIp, resolveRequestId } from './common/request-context';
import type { AppConfig } from './config/app-config';
import { createOpenApiDocument } from './openapi';

/**
 * Application composition, separated from process startup.
 *
 * `main.ts` used to hold both, which meant the only way to exercise the real request
 * pipeline was to run the real server — so no test ever did, and the guards, the cookie
 * plugin, the correlation-id hook and the global error filter were only ever verified
 * through unit tests that mocked them away. A test that re-created this wiring itself would
 * be worse than none: it would prove an application that production does not run.
 *
 * Everything here is composition. The only thing `main.ts` adds is `listen()`.
 */

/**
 * Fields scrubbed from every log line.
 *
 * Secrets must never reach logs (AGENTS §5/§6), and logs are the easiest place to leak
 * them by accident: `authorization` and `cookie` carry live sessions, `set-cookie` echoes
 * freshly issued ones, and the body fields cover passwords, PINs, OTP codes, and CSRF
 * tokens. Redaction happens at the logger so no individual call site can forget.
 */
const REDACTED_LOG_PATHS = [
	'req.headers.authorization',
	'req.headers.cookie',
	'req.headers["x-csrf-token"]',
	'res.headers["set-cookie"]',
	'req.body.password',
	'req.body.newPassword',
	'req.body.currentPassword',
	'req.body.pin',
	'req.body.code',
	'req.body.token',
	'req.body.csrfToken',
];

export function buildAdapter(config: AppConfig): FastifyAdapter {
	return new FastifyAdapter({
		// Required behind Cloudflare → Nginx so `request.ip` and the protocol are the
		// client's, not the proxy's. Off by default: trusting proxy headers on a
		// directly-exposed origin lets any caller forge their address.
		trustProxy: config.trustProxy,
		// Correlation id for every request. An inbound id is only honoured from a trusted
		// proxy; otherwise a fresh UUID is generated. `genReqId` runs before Fastify wraps
		// the request, so this receives the raw Node `IncomingMessage`.
		genReqId: (request: IncomingMessage) =>
			resolveRequestId(request.headers[REQUEST_ID_HEADER], config.trustProxy, randomUUID()),
		logger: {
			level: config.nodeEnv === 'test' ? 'silent' : config.logLevel,
			redact: { paths: REDACTED_LOG_PATHS, censor: '[redacted]' },
		},
	});
}

/**
 * Builds the fully-composed application without starting a listener.
 *
 * The returned app is NOT initialised: callers decide between `listen()` (production) and
 * `init()` plus Fastify's `inject()` (tests), and initialising here would take that choice
 * away.
 *
 * `config` configures the whole application: the HTTP adapter AND, through
 * `AppModule.forRoot`, every service that injects `APP_CONFIG`. It did not always — the
 * config module used to call `loadConfig()` itself, so the argument shaped the adapter while
 * the services read `process.env` behind it, and a harness that passed a one-second
 * `JWT_ACCESS_TTL` watched the access cookie refuse to expire.
 *
 * One exception remains, and it is not ours to fix here: the Mongo adapter reads its own
 * connection settings from `process.env` at connect time, so a caller redirecting the
 * database must still set `MONGODB_DB_NAME` in the environment.
 */
export async function createApp(config: AppConfig): Promise<NestFastifyApplication> {
	const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(config), buildAdapter(config));
	const instance = app.getHttpAdapter().getInstance();

	// Echo the correlation id on every response, including successful ones, so a client
	// or a support ticket can always name the exact request.
	instance.addHook('onSend', (request, reply, _payload, done) => {
		void reply.header(REQUEST_ID_HEADER, request.id);
		done();
	});

	// Parses cookies for the CSRF guard and the session cookies. No secret is configured:
	// these cookies are not signed — session integrity comes from the opaque token's own
	// entropy and its server-side hash, not from a cookie signature.
	await app.register(cookie);
	await app.register(helmet);
	await app.register(rateLimit, {
		max: config.rateLimitMax,
		timeWindow: config.rateLimitWindow,
		// Key on the REAL client IP; behind a proxy every request otherwise shares the
		// proxy's address and one caller can exhaust the limit for everyone.
		keyGenerator: (request) => resolveClientIp(request, config),
	});

	// Strict allowlist. `credentials: true` requires exact origins — never a wildcard —
	// because the browser refuses to send cookies to a wildcard origin anyway.
	app.enableCors({
		origin: config.corsAllowedOrigins,
		credentials: true,
		methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['content-type', 'accept', config.cookies.csrfHeader, REQUEST_ID_HEADER],
		exposedHeaders: [REQUEST_ID_HEADER],
		maxAge: 600,
	});

	app.useGlobalFilters(new HttpExceptionFilter());
	app.enableShutdownHooks();

	const document = createOpenApiDocument(app, `http://127.0.0.1:${config.port}`);
	SwaggerModule.setup('docs', app, document, {
		jsonDocumentUrl: 'openapi.json',
		raw: ['json'],
		ui: false,
	});

	return app;
}
