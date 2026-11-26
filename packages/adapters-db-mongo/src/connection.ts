import mongoose from 'mongoose';

import { buildMongoConfig, type MongoConfig } from './config';

let connection: typeof mongoose | null = null;

/**
 * Connect once (idempotent) and reuse the connection across the process.
 *
 * `autoIndex: false` skips building every model's indexes on connect. A test working in a fresh
 * database of its own passes it and builds only the indexes it needs: otherwise each such test asks
 * MongoDB for about 180 index builds at once, and with many test files running together the server
 * queues them (it builds three at a time) until setup hooks time out. Apps keep the default.
 */
export async function connectMongo(config?: Partial<MongoConfig> & { autoIndex?: boolean }): Promise<typeof mongoose> {
	if (connection && mongoose.connection.readyState === 1) {
		return connection;
	}

	const { autoIndex = true, ...rest } = config ?? {};
	const resolved = { ...buildMongoConfig(), ...rest };
	mongoose.set('strictQuery', true);
	connection = await mongoose.connect(resolved.uri, { dbName: resolved.dbName, autoIndex });
	return connection;
}

export async function disconnectMongo(): Promise<void> {
	if (connection) {
		await mongoose.disconnect();
		connection = null;
	}
}

export function getMongoose(): typeof mongoose {
	return mongoose;
}
