// Load apps/api/.env before anything reads process.env (as main.ts does).
import 'dotenv/config';
// Before every other module: tracing must see the drivers load (off unless configured).
import './tracing-worker';
import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { connectMongo, disconnectMongo } from '@saha-textile/adapters-db-mongo';

import { loadConfig } from './config/app-config';
import { exitOnDeploymentConfigError } from './config/boot-failure';
import { createAppLogger } from './infra/structured-logger';
import { composeMediaWorker } from './worker/media-worker';

/**
 * Media worker process: `node dist/worker.js` (the `worker` service in Compose, the same image
 * as the API). Encoding runs at low concurrency and is the only CPU-heavy work on the box.
 */
async function start(): Promise<void> {
	const config = loadConfig();
	// Job lines as JSON with personal data masked, like the API's.
	Logger.overrideLogger(createAppLogger(config));
	const logger = new Logger('MediaWorker');
	await connectMongo();
	const worker = await composeMediaWorker(config);

	const shutdown = async (signal: string) => {
		logger.log(`${signal} received — finishing the current jobs`);
		await worker.close();
		await disconnectMongo();
		process.exit(0);
	};
	process.once('SIGTERM', () => void shutdown('SIGTERM'));
	process.once('SIGINT', () => void shutdown('SIGINT'));
}

start().catch(exitOnDeploymentConfigError);
