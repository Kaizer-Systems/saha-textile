import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { SESSION_HEADER } from './lock/session.guard.js';

/**
 * The console's local API. It listens on 127.0.0.1 only, so nothing else on the network can
 * reach it, and accepts browser calls only from the console page on this computer.
 */
async function bootstrap(): Promise<void> {
	const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
	app.enableCors({
		origin: [process.env['CONSOLE_ORIGIN'] ?? 'http://localhost:4400'],
		methods: ['GET', 'POST', 'PUT', 'DELETE'],
		allowedHeaders: ['content-type', SESSION_HEADER],
	});
	const port = Number(process.env['CONSOLE_API_PORT'] ?? 4410);
	await app.listen({ port, host: '127.0.0.1' });
	new Logger('ReleaseConsoleApi').log(`Release Console API on http://127.0.0.1:${port}`);
}
void bootstrap();
