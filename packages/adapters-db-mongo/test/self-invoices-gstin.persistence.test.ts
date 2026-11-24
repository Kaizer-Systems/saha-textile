import { SelfInvoice } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { SelfInvoiceModel } from '../src/models/self-invoices.model';
import { MongoSelfInvoiceRepository } from '../src/repositories/self-invoices.repository';

import { hasMongoEnv } from './mongo-test-env';

/**
 * A GSTIN's issued self-invoices between two days, as GSTR-3B reads them (accounts brief G6):
 *   node scripts/secrets/test-login.mjs run saha_textile_gst_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/self-invoices-gstin.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('a GSTIN’s issued self-invoices (integration, rs0)', () => {
	const at = '2026-11-21T10:00:00.000Z';
	/** Registrations no other suite uses, so only this file's rows are cleared. */
	const REG = 'reg_sigst_a';
	const OTHER = 'reg_sigst_b';
	const wipe = () => SelfInvoiceModel.deleteMany({ gstRegistrationId: { $in: [REG, OTHER] } });
	const repo = new MongoSelfInvoiceRepository();

	const selfInvoice = (id: string, number: string | null, date: string | null, over: Partial<SelfInvoice> = {}) =>
		SelfInvoice.parse({
			id,
			number,
			status: number ? 'issued' : 'draft',
			supplierId: 'sup_bose',
			supplierName: 'Bose Properties',
			supplierAddress: 'Barasat',
			supplierStateCode: '19',
			rule: {
				templateCode: 'RS-RCM',
				templateVersion: 1,
				key: 'shop_rent',
				name: 'Rent of the shop',
				code: '997212',
				ratePercent: 18,
				expenseRole: 'rent',
				source: '13/2017',
			},
			forMonth: '2026-11',
			receivedOn: '2026-11-01',
			date,
			locationId: 'loc_bar',
			gstRegistrationId: REG,
			placeOfSupply: '19',
			interState: false,
			taxableINR: 60_000,
			cgstINR: 5_400,
			sgstINR: 5_400,
			igstINR: 0,
			taxINR: 10_800,
			totalINR: 70_800,
			paidINR: 0,
			late: false,
			journalVoucherId: null,
			cancelReason: null,
			version: 0,
			createdAt: at,
			createdBy: 'adm_owner',
			updatedAt: at,
			updatedBy: 'adm_owner',
			issuedAt: number ? at : null,
			issuedBy: number ? 'adm_owner' : null,
			cancelledAt: null,
			cancelledBy: null,
			...over,
		});

	beforeAll(async () => {
		await connectMongo();
		await SelfInvoiceModel.syncIndexes();
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('lists the GSTIN’s issued self-invoices from the first day to the last, by date then number', async () => {
		for (const next of [
			selfInvoice('si_gst_b', 'SI/GSTTEST/0002', '2026-11-01'),
			selfInvoice('si_gst_a', 'SI/GSTTEST/0001', '2026-11-01'),
			selfInvoice('si_gst_last', 'SI/GSTTEST/0009', '2026-11-30'),
			// Not issued, outside the days, or another GSTIN's: none is listed.
			selfInvoice('si_gst_draft', null, null),
			selfInvoice('si_gst_cancelled', 'SI/GSTTEST/0005', '2026-11-15', {
				status: 'cancelled',
				cancelReason: 'Raised twice',
				cancelledAt: at,
				cancelledBy: 'adm_owner',
			}),
			selfInvoice('si_gst_oct', 'SI/GSTTEST/0000', '2026-10-31'),
			selfInvoice('si_gst_dec', 'SI/GSTTEST/0010', '2026-12-01'),
			selfInvoice('si_gst_other', 'SI/GSTTEST/0003', '2026-11-10', { gstRegistrationId: OTHER }),
		])
			await repo.insert(next);
		const november = await repo.issuedForGstin(REG, '2026-11-01', '2026-11-30');
		expect(november.map((s) => [s.id, s.number, s.date])).toEqual([
			['si_gst_a', 'SI/GSTTEST/0001', '2026-11-01'],
			['si_gst_b', 'SI/GSTTEST/0002', '2026-11-01'],
			['si_gst_last', 'SI/GSTTEST/0009', '2026-11-30'],
		]);
		expect(november[0]).toMatchObject({ taxableINR: 60_000, cgstINR: 5_400, sgstINR: 5_400 });
		expect((await repo.issuedForGstin(OTHER, '2026-11-01', '2026-11-30')).map((s) => s.id)).toEqual([
			'si_gst_other',
		]);
		expect(await repo.issuedForGstin(REG, '2027-01-01', '2027-01-31')).toEqual([]);
	});
});
