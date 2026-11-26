import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { SETTLEMENT_KEYS, SettlementsGateway } from '@core/accounts/settlements.gateway';
import { runtimeConfig } from '@core/config/runtime-config';

import { PAYOUT_FIELDS, guessPayoutColumns, payoutRows, type PayoutColumns } from './payout-columns';

/** A gateway's payout file as CCAvenue lays it out, under a one-cell title line. */
const CCAVENUE_HEADING = ['Settlement Date', 'UTR No', 'Tracking ID', 'Order No', 'Txn Amount', 'TDR', 'GST'];
/** A courier's COD remittance as Shiprocket lays it out: no GST column. */
const SHIPROCKET_HEADING = ['Remittance ID', 'Remittance Date', 'AWB', 'Order ID', 'COD Amount', 'Charges'];

const NO_COLUMNS: PayoutColumns = {
	payoutReference: null,
	date: null,
	reference: null,
	gross: null,
	charges: null,
	gst: null,
};

describe('guessing a payout file’s columns', () => {
	it('names every field the reader fills, in order', () => {
		expect([...PAYOUT_FIELDS]).toEqual(['payoutReference', 'date', 'reference', 'gross', 'charges', 'gst']);
	});

	it('finds CCAvenue’s heading under its title line and reads each field from its own column', () => {
		const rows = [['CCAvenue settlement report', '', ' '], CCAVENUE_HEADING, ['24/11/2026', 'UTR1', 'T1']];
		expect(guessPayoutColumns(rows)).toEqual({
			headingAt: 1,
			columns: { payoutReference: 1, date: 0, reference: 2, gross: 4, charges: 5, gst: 6 },
		});
	});

	it('reads Shiprocket’s remittance headings and leaves GST empty when the file has none', () => {
		expect(guessPayoutColumns([SHIPROCKET_HEADING])).toEqual({
			headingAt: 0,
			columns: { payoutReference: 0, date: 1, reference: 2, gross: 4, charges: 5, gst: null },
		});
	});

	it('takes each column once: a “Tax amount” column is GST, so the money comes from the next amount', () => {
		expect(guessPayoutColumns([['UTR', 'Date', 'Reference', 'Tax amount', 'Amount']]).columns).toEqual({
			payoutReference: 0,
			date: 1,
			reference: 2,
			gst: 3,
			charges: null,
			gross: 4,
		});
		expect(guessPayoutColumns([['UTR', 'Date', 'Reference', 'Tax amount']]).columns.gross).toBeNull();
	});

	it('reads other names gateways and couriers use', () => {
		expect(
			guessPayoutColumns([['Payout ID', 'Payout Date', 'Payment ID', 'Processing fee', 'Service tax', 'Gross']])
				.columns,
		).toEqual({ payoutReference: 0, date: 1, reference: 2, charges: 3, gst: 4, gross: 5 });
		expect(
			guessPayoutColumns([['Settlement Ref', 'Settled Date', 'Transaction ID', 'Commission', 'Txn Amount']])
				.columns,
		).toEqual({ payoutReference: 0, date: 1, reference: 2, charges: 3, gst: null, gross: 4 });
	});

	it('starts at the first row when no row has three cells, and finds nothing in an empty file', () => {
		expect(
			guessPayoutColumns([
				['UTR', 'Date'],
				['  ', 'x', ''],
			]),
		).toEqual({
			headingAt: 0,
			columns: { ...NO_COLUMNS, payoutReference: 0, date: 1 },
		});
		expect(guessPayoutColumns([])).toEqual({ headingAt: 0, columns: NO_COLUMNS });
	});
});

describe('reading a payout file’s rows', () => {
	const ccavenue: PayoutColumns = { payoutReference: 1, date: 0, reference: 2, gross: 4, charges: 5, gst: 6 };

	it('reads each row after the heading in paise, skipping blank rows', () => {
		const rows = [
			['CCAvenue settlement report', '', ''],
			CCAVENUE_HEADING,
			[' 24/11/2026 ', ' UTR1 ', 'T1', 'SO-1', '1,180.00', '(23.60)', '-4.25'],
			['', '  '],
			[],
			['25/11/2026', 'UTR2', 'T2', 'SO-2', '₹ 500', '10', '1.80'],
		];
		expect(payoutRows(rows, 1, ccavenue, 'DD/MM/YYYY')).toEqual({
			rows: [
				{
					payoutReference: 'UTR1',
					date: '2026-11-24',
					reference: 'T1',
					grossPaise: 118000,
					chargesPaise: 2360,
					gstPaise: 425,
				},
				{
					payoutReference: 'UTR2',
					date: '2026-11-25',
					reference: 'T2',
					grossPaise: 50000,
					chargesPaise: 1000,
					gstPaise: 180,
				},
			],
			problems: [],
		});
	});

	it('reads a column the file lacks, or a cell a short row lacks, as nothing to pay', () => {
		const shiprocket: PayoutColumns = {
			payoutReference: 0,
			date: 1,
			reference: 2,
			gross: 4,
			charges: 5,
			gst: null,
		};
		const rows = [SHIPROCKET_HEADING, ['RM-7', '2026-11-20', 'AWB9', 'SO-9', '2,499.00']];
		expect(payoutRows(rows, 0, shiprocket, 'YYYY-MM-DD')).toEqual({
			rows: [
				{
					payoutReference: 'RM-7',
					date: '2026-11-20',
					reference: 'AWB9',
					grossPaise: 249900,
					chargesPaise: 0,
					gstPaise: 0,
				},
			],
			problems: [],
		});
	});

	it('names by its line number every row it cannot read', () => {
		const good = ['24/11/2026', 'UTR1', 'T1', 'SO-1', '100', '2', '0.36'];
		const rows = [
			CCAVENUE_HEADING,
			['31/02/2026', 'UTR1', 'T1', 'SO-1', '100', '2', '0.36'],
			['24/11/2026', 'UTR1', 'T1', 'SO-1', 'one hundred', '2', '0.36'],
			['24/11/2026', 'UTR1', 'T1', 'SO-1', '100', '2.005', '0.36'],
			['24/11/2026', 'UTR1', 'T1', 'SO-1', '100', '2', 'n/a'],
			['24/11/2026', ' ', 'T1', 'SO-1', '100', '2', '0.36'],
			['24/11/2026', 'UTR1', '', 'SO-1', '100', '2', '0.36'],
			good,
		];
		const read = payoutRows(rows, 0, ccavenue, 'DD/MM/YYYY');
		expect(read.problems).toEqual([2, 3, 4, 5, 6, 7]);
		expect(read.rows).toEqual([
			{
				payoutReference: 'UTR1',
				date: '2026-11-24',
				reference: 'T1',
				grossPaise: 10000,
				chargesPaise: 200,
				gstPaise: 36,
			},
		]);
	});

	it('reads no row at all when no column is chosen, as a row needs its day', () => {
		expect(
			payoutRows(
				[
					['h', 'h', 'h'],
					['a', 'b', 'c'],
				],
				0,
				NO_COLUMNS,
				'DD/MM/YYYY',
			),
		).toEqual({
			rows: [],
			problems: [2],
		});
	});
});

describe('the settlements gateway', () => {
	it('names its query keys after the list it reads', () => {
		const query = { kind: 'cod', from: '2026-11-01', to: '2026-11-30', page: 2, pageSize: 20 } as const;
		expect(SETTLEMENT_KEYS.all).toEqual(['settlements']);
		expect(SETTLEMENT_KEYS.list(query)).toEqual(['settlements', 'list', query]);
	});

	it('calls each settlements route', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		const gateway = TestBed.inject(SettlementsGateway);
		const http = TestBed.inject(HttpTestingController);
		const api = `${runtimeConfig.apiUrl}/admin/accounts/settlements`;
		const calls: [() => unknown, string, string][] = [
			[
				() => gateway.list({ kind: 'gateway', from: '2026-11-01', to: '2026-11-30', page: 1, pageSize: 20 }),
				'GET',
				'?kind=gateway&from=2026-11-01&to=2026-11-30&page=1&pageSize=20',
			],
			[() => gateway.one('st/1'), 'GET', '/st%2F1'],
			[() => gateway.preview({} as never), 'POST', '/preview'],
			[() => gateway.import({} as never), 'POST', ''],
		];
		for (const [call, method, path] of calls) {
			(call() as { subscribe: () => void }).subscribe();
			http.expectOne((req) => req.method === method && req.urlWithParams === api + path).flush({});
		}
		http.verify();
	});
});
