import { z } from 'zod';

/**
 * MongoDB connection config for the self-hosted Docker MongoDB 8.3
 * single-node replica set (`rs0`) — the same profile locally and in prod
 * (never Atlas). Credentials are taken RAW from env and percent-encoded at
 * runtime via encodeURIComponent (so a literal `@` becomes `%40`), then the
 * `mongodb://` URI is assembled. Alternatively a full pre-encoded MONGODB_URI
 * may be provided and is used verbatim (it must include `replicaSet=rs0`).
 */
const EnvSchema = z.object({
	MONGODB_URI: z.string().min(1).optional(),
	MONGODB_HOST: z.string().min(1).default('127.0.0.1'),
	MONGODB_PORT: z.coerce.number().int().positive().default(27017),
	MONGODB_USERNAME: z.string().min(1).optional(),
	MONGODB_PASSWORD: z.string().min(1).optional(),
	MONGODB_REPLICA_SET: z.string().min(1).default('rs0'),
	MONGODB_DB_NAME: z.string().min(1).default('saha_textile_local'),
	MONGODB_APP_NAME: z.string().min(1).optional(),
});

export interface MongoConfig {
	uri: string;
	dbName: string;
}

export function buildMongoConfig(env: NodeJS.ProcessEnv = process.env): MongoConfig {
	const parsed = EnvSchema.parse({
		// Blank strings in .env mean "unset" — let defaults/optionals apply.
		MONGODB_URI: env.MONGODB_URI || undefined,
		MONGODB_HOST: env.MONGODB_HOST || undefined,
		MONGODB_PORT: env.MONGODB_PORT || undefined,
		MONGODB_USERNAME: env.MONGODB_USERNAME || undefined,
		MONGODB_PASSWORD: env.MONGODB_PASSWORD || undefined,
		MONGODB_REPLICA_SET: env.MONGODB_REPLICA_SET || undefined,
		MONGODB_DB_NAME: env.MONGODB_DB_NAME || undefined,
		MONGODB_APP_NAME: env.MONGODB_APP_NAME || undefined,
	});

	if (parsed.MONGODB_URI) {
		return { uri: parsed.MONGODB_URI, dbName: parsed.MONGODB_DB_NAME };
	}

	// Local dev runs the Docker replica set without auth; deployed profiles set
	// both username and password (never just one).
	if (!parsed.MONGODB_USERNAME !== !parsed.MONGODB_PASSWORD) {
		throw new Error('MongoDB config invalid: set both MONGODB_USERNAME and MONGODB_PASSWORD, or neither.');
	}

	const auth =
		parsed.MONGODB_USERNAME && parsed.MONGODB_PASSWORD
			? `${encodeURIComponent(parsed.MONGODB_USERNAME)}:${encodeURIComponent(parsed.MONGODB_PASSWORD)}@` // '@' -> '%40'
			: '';

	const params = new URLSearchParams({
		replicaSet: parsed.MONGODB_REPLICA_SET,
		directConnection: 'true', // single-node replica set
		retryWrites: 'true',
		w: 'majority',
	});
	if (parsed.MONGODB_APP_NAME) params.set('appName', parsed.MONGODB_APP_NAME);

	const uri = `mongodb://${auth}${parsed.MONGODB_HOST}:${parsed.MONGODB_PORT}/${parsed.MONGODB_DB_NAME}?${params.toString()}`;
	return { uri, dbName: parsed.MONGODB_DB_NAME };
}
