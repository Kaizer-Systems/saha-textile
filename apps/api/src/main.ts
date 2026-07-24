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
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { loadConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
	const config = loadConfig();
	const logger = new Logger('Bootstrap');

	const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

	// Security headers (CSP disabled so the Swagger UI can load its assets).
	await app.register(helmet, { contentSecurityPolicy: false });
	await app.register(rateLimit, { max: config.rateLimitMax, timeWindow: config.rateLimitWindow });

	app.enableCors({ origin: config.corsAllowedOrigins, credentials: true });
	app.enableShutdownHooks();

	const swaggerConfig = new DocumentBuilder()
		.setTitle('Saha Textile API')
		.setDescription('Storefront + admin API (catalog, cart, orders, currency, promotions, auth)')
		.setVersion('0.1.0')
		.addBearerAuth()
		.build();
	const document = SwaggerModule.createDocument(app, swaggerConfig);
	SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'openapi.json' });

	await app.listen({ port: config.port, host: '0.0.0.0' });
	logger.log(`API listening on http://localhost:${config.port} (docs at /docs, spec at /openapi.json)`);
}

void bootstrap();
