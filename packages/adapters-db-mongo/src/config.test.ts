import { describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';

describe('buildMongoConfig (self-hosted Docker)', () => {
	it('assembles a local no-auth replica-set URI with directConnection', () => {
		const { uri, dbName } = buildMongoConfig({
			MONGODB_HOST: '127.0.0.1',
			MONGODB_PORT: '27017',
			MONGODB_DB_NAME: 'saha_local',
			MONGODB_REPLICA_SET: 'rs0',
		});
		expect(dbName).toBe('saha_local');
		expect(uri).toContain('mongodb://127.0.0.1:27017/saha_local?');
		expect(uri).toContain('replicaSet=rs0');
		expect(uri).toContain('directConnection=true');
	});

	it('percent-encodes passwords and sets authSource for Docker auth users', () => {
		const { uri } = buildMongoConfig({
			MONGODB_HOST: 'mongo',
			MONGODB_PORT: '27017',
			MONGODB_USERNAME: 'saha_api',
			MONGODB_PASSWORD: 'p@ss:word/1',
			MONGODB_DB_NAME: 'saha_prod',
			MONGODB_REPLICA_SET: 'rs0',
			MONGODB_DIRECT_CONNECTION: 'false',
		});
		expect(uri).toContain('mongodb://saha_api:p%40ss%3Aword%2F1@mongo:27017/saha_prod?');
		expect(uri).toContain('authSource=admin');
		expect(uri).toContain('replicaSet=rs0');
		expect(uri).not.toContain('directConnection=true');
	});

	it('uses MONGODB_URI verbatim when provided', () => {
		const raw =
			'mongodb://127.0.0.1:27017/saha_local?replicaSet=rs0&directConnection=true';
		const { uri, dbName } = buildMongoConfig({
			MONGODB_URI: raw,
			MONGODB_DB_NAME: 'saha_local',
		});
		expect(uri).toBe(raw);
		expect(dbName).toBe('saha_local');
	});
});
