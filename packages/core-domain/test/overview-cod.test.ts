import { describe, expect, it } from 'vitest';

import { overviewFigures } from '../src/ledger/overview-rules';
import { UNSETTLED_AFTER_DAYS, UNSETTLED_LOOKBACK_DAYS } from '../src/settlements/settlement-rules';

import type { ChartOfAccounts } from '@saha-textile/contracts';

/** Accounts › Overview (accounts brief Q0, Q10): cash on delivery the couriers hold, and the unpaid-payout check. */

const ledger = (id: string, systemKey: string | null, roles: string[] = []) =>
	({ id, name: id, groupId: 'current_assets', nature: 'asset', systemKey, roles }) as never;

const chart = (...ledgers: never[]): ChartOfAccounts => ({
	groups: [
		{ id: 'current_assets', parentId: null, nature: 'asset', systemKey: 'current_assets', roles: [] } as never,
	],
	ledgers,
});

describe('cash on delivery on the overview', () => {
	it('adds what every ledger playing COD receivable holds, by its system key or by its roles', () => {
		const books = chart(
			ledger('cod_receivable', 'cod_receivable'),
			ledger('led_cod_shiprocket', null, ['cod_receivable']),
			ledger('led_cod_delhivery', null, ['cod_receivable']),
			ledger('gateway_clearing', 'gateway_clearing'),
		);
		const now = {
			cod_receivable: 120_000,
			led_cod_shiprocket: 1_499_500,
			led_cod_delhivery: 250_000,
			gateway_clearing: 9_000_000,
		};
		expect(overviewFigures(books, now, {}, {}).codPaise).toBe(1_869_500);
	});

	it('counts a COD ledger with no balance yet as nothing, and a COD ledger the couriers over-remitted as less', () => {
		const books = chart(
			ledger('led_cod_shiprocket', null, ['cod_receivable']),
			ledger('cod_receivable', 'cod_receivable'),
		);
		expect(overviewFigures(books, { cod_receivable: 500_000 }, {}, {}).codPaise).toBe(500_000);
		expect(overviewFigures(books, { cod_receivable: 500_000, led_cod_shiprocket: -700_000 }, {}, {}).codPaise).toBe(
			-200_000,
		);
	});

	it('leaves out a ledger whose roles say it no longer plays COD receivable, whatever its system key', () => {
		const books = chart(
			ledger('cod_receivable', 'cod_receivable', ['gateway_clearing']),
			ledger('led_cod_shiprocket', null, ['cod_receivable']),
		);
		expect(overviewFigures(books, { cod_receivable: 800_000, led_cod_shiprocket: 300_000 }, {}, {}).codPaise).toBe(
			300_000,
		);
	});

	it('reads books without a COD ledger as nothing held', () => {
		expect(overviewFigures(chart(ledger('cash', 'cash')), { cash: 10_000 }, {}, {}).codPaise).toBe(0);
	});
});

describe('the unpaid-payout check', () => {
	it('flags a gateway payment after 7 days without a payout, looking back 90 days', () => {
		expect(UNSETTLED_AFTER_DAYS).toBe(7);
		expect(UNSETTLED_LOOKBACK_DAYS).toBe(90);
		expect(UNSETTLED_LOOKBACK_DAYS).toBeGreaterThan(UNSETTLED_AFTER_DAYS);
	});
});
