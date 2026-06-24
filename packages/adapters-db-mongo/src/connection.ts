import mongoose from 'mongoose';

import { buildMongoConfig, type MongoConfig } from './config';

let connection: typeof mongoose | null = null;

/** Connect once (idempotent) and reuse the connection across the process. */
export async function connectMongo(config?: Partial<MongoConfig>): Promise<typeof mongoose> {
	if (connection && mongoose.connection.readyState === 1) {
		return connection;
	}

	const resolved = { ...buildMongoConfig(), ...config };
	mongoose.set('strictQuery', true);
	connection = await mongoose.connect(resolved.uri, { dbName: resolved.dbName });
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
