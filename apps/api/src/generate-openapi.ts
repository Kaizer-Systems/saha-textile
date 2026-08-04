import 'dotenv/config';
import 'reflect-metadata';

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module';
import { createOpenApiDocument } from './openapi';

function readArgument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

async function generate(): Promise<void> {
	process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD = '1';
	const outputPath = resolve(readArgument('--output') ?? 'dist/openapi.json');
	const serverUrl = readArgument('--server') ?? 'http://127.0.0.1:4000';
	const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(), new FastifyAdapter(), {
		logger: false,
	});

	try {
		await app.init();
		const document = createOpenApiDocument(app, serverUrl);
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
		process.stdout.write(`Generated scaffolded OpenAPI document at ${outputPath}\n`);
	} finally {
		await app.close();
	}
}

void generate();
