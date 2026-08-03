// Load apps/api/.env before anything reads process.env (Nest CLI does not).
// Deployed environments inject env via Compose env_file/secrets instead;
// dotenv is a no-op there when no .env file is present.
import 'dotenv/config';
import 'reflect-metadata';

import { Logger } from '@nestjs/common';

import { createApp } from './bootstrap';
import { loadConfig } from './config/app-config';

/**
 * Process startup.
 *
 * Composition lives in `bootstrap.ts` so a test can build the SAME application and drive it
 * through Fastify's `inject()` without binding a socket. What remains here is precisely the
 * part a test must not do: read the ambient environment and take a port.
 */
async function bootstrap(): Promise<void> {
	const config = loadConfig();
	const logger = new Logger('Bootstrap');

	const app = await createApp(config);

	await app.listen({ port: config.port, host: '0.0.0.0' });
	logger.log(
		`API listening on http://localhost:${config.port} (OpenAPI at /openapi.json, health at /health/live and /health/ready)`,
	);
}

void bootstrap();
