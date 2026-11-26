import { z } from 'zod';

/**
 * MongoDB connection config for the self-hosted Docker MongoDB 9.0.4
 * single-node replica set (`rs0`) — the same profile locally and in prod
 * (never Atlas). Credentials are taken RAW from env and percent-encoded at
 * runtime via encodeURIComponent (so a literal `@` becomes `%40`), then the
 * `mongodb://` URI is assembled. Alternatively a full pre-encoded MONGODB_URI
 * may be provided and is used verbatim (it must include `replicaSet=rs0`); its
 * database applies when MONGODB_DB_NAME is not set.
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

/**
 * A developer machine's test login (scripts/secrets/test-login.mjs). MongoDB cannot limit a login by
 * database name, so it may read, write and drop any database on that machine; here it is held to
 * test databases, so a run that forgets MONGODB_DB_NAME can never reach the working database.
 */
export const TEST_LOGIN = 'saha_textile_tests';

/** A test database: a name ending in _it, _e2e or _test, or one of those followed by more words. */
export const TEST_DATABASE_NAME = /_(it|e2e|test)(_[a-z0-9_]+)?$/;

/** The database named in a `mongodb://` address, if any. */
function databaseInUri(uri: string): string | undefined {
	const name = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/.exec(uri)?.[1];
	return name ? decodeURIComponent(name) : undefined;
}

/** The login named in a `mongodb://` address, if any. */
function loginInUri(uri: string): string | undefined {
	const user = /^mongodb(?:\+srv)?:\/\/([^:@/]+)(?::[^@/]*)?@/.exec(uri)?.[1];
	return user ? decodeURIComponent(user) : undefined;
}

function refuseTestLoginOutsideTests(login: string | undefined, dbName: string): void {
	if (login === TEST_LOGIN && !TEST_DATABASE_NAME.test(dbName)) {
		throw new Error(
			`MongoDB config refused: the test login may only open a test database (a name ending in _it, _e2e or _test), not ${dbName}.`,
		);
	}
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
		// Without MONGODB_DB_NAME, the database the address names, never the working default.
		const dbName =
			(env.MONGODB_DB_NAME ? parsed.MONGODB_DB_NAME : databaseInUri(parsed.MONGODB_URI)) ??
			parsed.MONGODB_DB_NAME;
		refuseTestLoginOutsideTests(loginInUri(parsed.MONGODB_URI), dbName);
		return { uri: parsed.MONGODB_URI, dbName };
	}

	// Local dev runs the Docker replica set without auth; deployed profiles set
	// both username and password (never just one).
	if (!parsed.MONGODB_USERNAME !== !parsed.MONGODB_PASSWORD) {
		throw new Error('MongoDB config invalid: set both MONGODB_USERNAME and MONGODB_PASSWORD, or neither.');
	}

	refuseTestLoginOutsideTests(parsed.MONGODB_USERNAME, parsed.MONGODB_DB_NAME);

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
