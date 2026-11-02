// Load apps/api/.env before anything reads process.env (as main.ts does).
import 'dotenv/config';
import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { connectMongo, disconnectMongo } from '@saha-textile/adapters-db-mongo';

import { loadConfig } from './config/app-config';
import { composeMediaWorker } from './worker/media-worker';

/**
 * Media worker process: `node dist/worker.js` (the `worker` service in Compose, the same image
 * as the API). Encoding runs at low concurrency and is the only CPU-heavy work on the box.
 */
async function start(): Promise<void> {
	const logger = new Logger('MediaWorker');
	const config = loadConfig();
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

void start();
