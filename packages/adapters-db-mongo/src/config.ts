import { z } from 'zod';

/**
 * MongoDB connection config for self-hosted Docker MongoDB 8.3 (replica set).
 *
 * Prefer:
 * 1. `MONGODB_URI` — full URI (must include `replicaSet=rs0` for transactions), or
 * 2. Parts: username/password optional for local no-auth; host/port/replicaSet/db.
 *
 * Passwords are taken RAW and percent-encoded at assembly time.
 * Atlas `mongodb+srv` / `MONGODB_CLUSTER_HOST` is legacy — still accepted if URI/parts
 * look like SRV, but local/prod launch path is non-SRV Docker Mongo.
 */
const EnvSchema = z.object({
	MONGODB_URI: z.string().min(1).optional(),
	MONGODB_USERNAME: z.string().min(1).optional(),
	MONGODB_PASSWORD: z.string().min(1).optional(),
	/** @deprecated Prefer MONGODB_HOST for Docker Mongo. Kept for old Atlas-style envs. */
	MONGODB_CLUSTER_HOST: z.string().min(1).optional(),
	MONGODB_HOST: z.string().min(1).optional(),
	MONGODB_PORT: z.coerce.number().int().positive().optional(),
	MONGODB_REPLICA_SET: z.string().min(1).optional(),
	MONGODB_AUTH_SOURCE: z.string().min(1).optional(),
	MONGODB_DB_NAME: z.string().min(1).default('saha_local'),
	MONGODB_APP_NAME: z.string().min(1).optional(),
	/** Single-node Docker RS from the host: prefer true so discovery stays on loopback. */
	MONGODB_DIRECT_CONNECTION: z
		.enum(['true', 'false'])
		.optional()
		.transform((v) => (v === undefined ? undefined : v === 'true')),
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

	const host = parsed.MONGODB_HOST ?? parsed.MONGODB_CLUSTER_HOST;
	if (!host) {
		throw new Error(
			'MongoDB config missing: provide MONGODB_URI, or MONGODB_HOST (or legacy MONGODB_CLUSTER_HOST).',
		);
	}

	const isSrv = host.includes('mongodb.net') || host.startsWith('mongodb+srv://');
	const user = parsed.MONGODB_USERNAME ? encodeURIComponent(parsed.MONGODB_USERNAME) : null;
	const pwd = parsed.MONGODB_PASSWORD ? encodeURIComponent(parsed.MONGODB_PASSWORD) : null;
	const auth =
		user && pwd ? `${user}:${pwd}@` : user && !pwd ? `${user}@` : '';

	const params = new URLSearchParams();
	const replicaSet = parsed.MONGODB_REPLICA_SET ?? (isSrv ? undefined : 'rs0');
	if (replicaSet) params.set('replicaSet', replicaSet);
	if (parsed.MONGODB_AUTH_SOURCE) params.set('authSource', parsed.MONGODB_AUTH_SOURCE);
	else if (user && pwd && !isSrv) params.set('authSource', 'admin');
	if (parsed.MONGODB_APP_NAME) params.set('appName', parsed.MONGODB_APP_NAME);

	const direct =
		parsed.MONGODB_DIRECT_CONNECTION ??
		(!isSrv && (host === 'localhost' || host === '127.0.0.1'));
	if (direct) params.set('directConnection', 'true');

	if (isSrv) {
		params.set('retryWrites', 'true');
		params.set('w', 'majority');
		const uri = `mongodb+srv://${auth}${host.replace(/^mongodb\+srv:\/\//, '')}/${parsed.MONGODB_DB_NAME}?${params.toString()}`;
		return { uri, dbName: parsed.MONGODB_DB_NAME };
	}

	const port = parsed.MONGODB_PORT ?? 27017;
	const qs = params.toString();
	const uri = `mongodb://${auth}${host}:${port}/${parsed.MONGODB_DB_NAME}${qs ? `?${qs}` : ''}`;
	return { uri, dbName: parsed.MONGODB_DB_NAME };
}
