import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { DocumentFormatModel } from '../src/models/index';
import { MongoDocumentFormatRepository } from '../src/repositories/document-format.repository';
import { MongoBusinessRepository } from '../src/repositories/orders-build.repository';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

describe.runIf(hasMongoEnv())('document formats and buyer search: the last cases (rs0)', () => {
	const P = runPrefix('more');

	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		await DocumentFormatModel.deleteMany({ _id: { $regex: `^${P}` } });
		await disconnectMongo();
	});

	it('reads a format written before it kept a change date', async () => {
		await insertRaw(DocumentFormatModel as never, { _id: `${P}fmt`, doc: 'invoice', name: 'Old invoice' });
		expect(await new MongoDocumentFormatRepository().findById(`${P}fmt`)).toMatchObject({
			id: `${P}fmt`,
			updatedAt: null,
			updatedBy: null,
		});
	});

	it('searches buyers by phone and mobile when the words hold four digits or more', async () => {
		expect(await new MongoBusinessRepository().searchBuyers(`${P} 98300 12`, 5)).toEqual([]);
	});
});
