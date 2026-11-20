import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { SESSION_HEADER } from './lock/session.guard.js';

/**
 * The console's API. On the Mac it listens on 127.0.0.1 only; inside its Docker image it listens on
 * every address of the container (`CONSOLE_HOST=0.0.0.0`) while Compose publishes it on the Mac's
 * 127.0.0.1 only. Browser calls from another page are refused (`CONSOLE_ORIGIN`).
 */
async function bootstrap(): Promise<void> {
	const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
	app.enableCors({
		origin: [process.env['CONSOLE_ORIGIN'] ?? 'http://localhost:4400'],
		methods: ['GET', 'POST', 'PUT', 'DELETE'],
		allowedHeaders: ['content-type', SESSION_HEADER],
	});
	const port = Number(process.env['CONSOLE_API_PORT'] ?? 4410);
	const host = process.env['CONSOLE_HOST'] ?? '127.0.0.1';
	app.enableShutdownHooks();
	await app.listen({ port, host });
	new Logger('ReleaseConsoleApi').log(
		`Release Console ${process.env['CONSOLE_APP_DIR'] ? 'app and API' : 'API'} on ${host}:${port}`,
	);
}
void bootstrap();
