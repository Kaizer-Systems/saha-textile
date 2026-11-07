import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import type { Connection } from 'mongoose';

const adapterPackage = resolve(__dirname, '../packages/adapters-db-mongo/package.json');
const mongoose = createRequire(adapterPackage)('mongoose') as typeof import('mongoose');

const DATABASE = 'saha_textile_e2e';

const envFile = resolve(__dirname, '../apps/api/.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** Opens the throwaway browser-test database for one step. Tests never touch any other. */
export async function withDatabase<T>(work: (connection: Connection) => Promise<T>): Promise<T> {
	const host = process.env['MONGODB_HOST'] || '127.0.0.1';
	const port = process.env['MONGODB_PORT'] || '27017';
	const replicaSet = process.env['MONGODB_REPLICA_SET'] || 'rs0';
	const connection = await mongoose
		.createConnection(`mongodb://${host}:${port}/${DATABASE}?replicaSet=${replicaSet}&directConnection=true`)
		.asPromise();
	try {
		return await work(connection);
	} finally {
		await connection.close();
	}
}
