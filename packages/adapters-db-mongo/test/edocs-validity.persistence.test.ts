import { EDocument } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { EDocumentModel } from '../src/models/edocs.model';
import { MongoEDocRepository } from '../src/repositories/edocs.repository';

import { hasMongoEnv, runPrefix } from './mongo-test-env';

/**
 * E-way bills by validity (brief 25 follow-ups): still valid, ending within a day, or ended, against a given time:
 *   MONGODB_DB_NAME=saha_textile_test node scripts/secrets/test-login.mjs run saha_textile_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/edocs-validity.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('e-way bills by validity (integration, rs0)', () => {
	const P = runPrefix('edoc_valid');
	const tag = P.replace(/_/g, '');
	const repo = new MongoEDocRepository();
	const at = '2026-11-25T12:00:00.000Z';
	const bill = (name: string, validUntil: string | null) =>
		EDocument.parse({
			id: `${P}${name}`,
			kind: 'eWayBill',
			gstin: '19DBYPS6736R1ZZ',
			documentType: 'taxInvoice',
			documentId: `${P}inv_${name}`,
			documentNumber: `${tag}-${name}`,
			documentDate: '2026-11-24',
			path: 'manual',
			status: 'active',
			ewbNumber: null,
			validUntil,
			createdAt: '2026-11-24T05:00:00.000Z',
			createdBy: 'adm_clerk',
		});
	const BILLS: [string, string | null][] = [
		['open', null],
		['later', '2026-11-28T18:29:59.999Z'],
		['soon', '2026-11-26T06:00:00.000Z'],
		['day_edge', '2026-11-26T12:00:00.000Z'],
		['at_edge', at],
		['earlier', '2026-11-24T18:29:59.999Z'],
		['future', '2099-01-01T00:00:00.000Z'],
		['past', '2001-01-01T00:00:00.000Z'],
	];
	const names = async (over: { validity?: 'current' | 'endsSoon' | 'ended'; at?: string; q?: string }) =>
		(await repo.list({ kind: 'eWayBill', q: tag, page: 1, pageSize: 50, ...over })).rows
			.map((row) => row.documentNumber.slice(tag.length + 1))
			.sort();

	beforeAll(async () => {
		await connectMongo();
		for (const [name, validUntil] of BILLS) await repo.insert(bill(name, validUntil));
	});
	afterAll(async () => {
		await EDocumentModel.deleteMany({ _id: { $regex: `^${P}` } }).exec();
		await disconnectMongo();
	});

	it('lists every bill when no validity is asked', async () => {
		expect(await names({ at })).toEqual(BILLS.map(([name]) => name).sort());
	});

	it('counts a bill with no end, or one ending after the time, as still valid', async () => {
		expect(await names({ validity: 'current', at })).toEqual(['day_edge', 'future', 'later', 'open', 'soon']);
	});

	it('counts a bill ending after the time and within a day of it as ending soon, the day’s last instant included', async () => {
		expect(await names({ validity: 'endsSoon', at })).toEqual(['day_edge', 'soon']);
	});

	it('counts a bill whose end has come, at the very time too, as ended, and never one with no end', async () => {
		expect(await names({ validity: 'ended', at })).toEqual(['at_edge', 'earlier', 'past']);
	});

	it('judges on the clock when no time is given, and keeps to the search as well', async () => {
		expect(await names({ validity: 'current', q: `${tag}-future` })).toEqual(['future']);
		expect(await names({ validity: 'ended', q: `${tag}-past` })).toEqual(['past']);
		expect(await names({ validity: 'ended', q: `${tag}-future` })).toEqual([]);
		const page = await repo.list({
			kind: 'eWayBill',
			q: `${tag}-soon`,
			validity: 'endsSoon',
			at,
			page: 1,
			pageSize: 5,
		});
		expect([page.total, page.rows[0]?.id]).toEqual([1, `${P}soon`]);
		expect(
			(await repo.list({ kind: 'eInvoice', q: tag, validity: 'current', at, page: 1, pageSize: 5 })).total,
		).toBe(0);
	});
});
