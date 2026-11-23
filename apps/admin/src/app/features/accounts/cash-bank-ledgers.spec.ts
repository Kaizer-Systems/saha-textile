import { describe, expect, it } from 'vitest';

import { cashAndBankLedgers } from './cash-bank-ledgers';

describe('cash and bank ledgers', () => {
	it('keeps active ledgers under cash or a bank, however deep, and nothing without a chart', () => {
		const chart = {
			groups: [
				{ id: 'g_ca', systemKey: 'current_assets', parentId: null },
				{ id: 'g_bank', systemKey: 'bank_accounts', parentId: 'g_ca' },
				{ id: 'g_hdfc', systemKey: null, parentId: 'g_bank' },
				{ id: 'g_exp', systemKey: null, parentId: null },
			],
			ledgers: [
				{ id: 'led_hdfc', groupId: 'g_hdfc', active: true },
				{ id: 'led_old', groupId: 'g_bank', active: false },
				{ id: 'led_rent', groupId: 'g_exp', active: true },
				{ id: 'led_lost', groupId: 'g_gone', active: true },
			],
		};
		expect(cashAndBankLedgers(chart as never).map((l) => l.id)).toEqual(['led_hdfc']);
		expect(cashAndBankLedgers(undefined)).toEqual([]);
	});
});
