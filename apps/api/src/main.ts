// Load apps/api/.env before anything reads process.env (Nest CLI does not).
// Deployed environments inject env via Compose env_file/secrets instead;
// dotenv is a no-op there when no .env file is present.
import 'dotenv/config';
import 'reflect-metadata';

import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { loadConfig } from './config/app-config';
import { createOpenApiDocument } from './openapi';

async function bootstrap(): Promise<void> {
	const config = loadConfig();
	const logger = new Logger('Bootstrap');

	const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

	await app.register(helmet);
	await app.register(rateLimit, { max: config.rateLimitMax, timeWindow: config.rateLimitWindow });

	app.enableCors({ origin: config.corsAllowedOrigins, credentials: true });
	app.enableShutdownHooks();

	const document = createOpenApiDocument(app, `http://127.0.0.1:${config.port}`);
	SwaggerModule.setup('docs', app, document, {
		jsonDocumentUrl: 'openapi.json',
		raw: ['json'],
		ui: false,
	});

	await app.listen({ port: config.port, host: '0.0.0.0' });
	logger.log(`API listening on http://localhost:${config.port} (OpenAPI at /openapi.json)`);
}

void bootstrap();
