import { z } from 'zod';

/**
 * MongoDB connection config. The password is taken RAW from env and
 * percent-encoded at runtime via encodeURIComponent (so a literal `@` becomes
 * `%40`), then the SRV URI is assembled. Alternatively a full pre-encoded
 * MONGODB_URI may be provided and is used verbatim.
 */
const EnvSchema = z.object({
	MONGODB_URI: z.string().min(1).optional(),
	MONGODB_USERNAME: z.string().min(1).optional(),
	MONGODB_PASSWORD: z.string().min(1).optional(),
	MONGODB_CLUSTER_HOST: z.string().min(1).optional(),
	MONGODB_DB_NAME: z.string().min(1).default('saha_local'),
	MONGODB_APP_NAME: z.string().min(1).optional(),
});

export interface MongoConfig {
	uri: string;
	dbName: string;
}

export function buildMongoConfig(env: NodeJS.ProcessEnv = process.env): MongoConfig {
	const parsed = EnvSchema.parse(env);

	if (parsed.MONGODB_URI) {
		return { uri: parsed.MONGODB_URI, dbName: parsed.MONGODB_DB_NAME };
	}

	if (!parsed.MONGODB_USERNAME || !parsed.MONGODB_PASSWORD || !parsed.MONGODB_CLUSTER_HOST) {
		throw new Error(
			'MongoDB config missing: provide MONGODB_URI, or all of MONGODB_USERNAME, MONGODB_PASSWORD, MONGODB_CLUSTER_HOST.',
		);
	}

	const user = encodeURIComponent(parsed.MONGODB_USERNAME);
	const pwd = encodeURIComponent(parsed.MONGODB_PASSWORD); // '@' -> '%40'
	const params = new URLSearchParams({ retryWrites: 'true', w: 'majority' });
	if (parsed.MONGODB_APP_NAME) params.set('appName', parsed.MONGODB_APP_NAME);

	const uri = `mongodb+srv://${user}:${pwd}@${parsed.MONGODB_CLUSTER_HOST}/${parsed.MONGODB_DB_NAME}?${params.toString()}`;
	return { uri, dbName: parsed.MONGODB_DB_NAME };
}
