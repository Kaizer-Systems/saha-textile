import { MongoEDocKeyStore, UnavailableEDocKeyStore } from '@saha-textile/adapters-db-mongo';
import { describe, expect, it } from 'vitest';

import { edocKeyStoreFor } from '../src/edocs/edocs.module';

describe('where e-document keys are kept (addendum 2, AE6)', () => {
	const key = Buffer.alloc(32, 7).toString('base64');
	it('seals keys under the server key, keeping the previous one while it rotates', () => {
		expect(edocKeyStoreFor({ edocs: { keysKey: key, keysKeyPrevious: null } } as never)).toBeInstanceOf(
			MongoEDocKeyStore,
		);
		expect(edocKeyStoreFor({ edocs: { keysKey: key, keysKeyPrevious: key } } as never)).toBeInstanceOf(
			MongoEDocKeyStore,
		);
	});
	it('offers only the by-hand path without a server key', () => {
		const store = edocKeyStoreFor({ edocs: { keysKey: null, keysKeyPrevious: null } } as never);
		expect(store).toBeInstanceOf(UnavailableEDocKeyStore);
		expect(store.available).toBe(false);
	});
});
