import { describe, expect, it, vi } from 'vitest';

import { LedgerService } from '../src/ledger/ledger.service';

/**
 * AT3: setting up a firm's or an LLP's books makes each partner's ledgers from Settings › Company: capital (an LLP's
 * contribution) and, with fixed capital, a current account. Each plays its own role, so it is never made twice.
 */

const GROUPS = [
	{ id: 'grp_capital_account', systemKey: 'capital_account', nature: 'liability' },
	{ id: 'grp_partners_current', systemKey: 'partners_current', nature: 'liability' },
];
/** A partner id long enough that its role is cut at 60 characters. */
const LONG_ID = `Partner-${'9'.repeat(60)}`;

function build(profile: unknown) {
	const saved: { id: string; name: string; groupId: string; roles: string[] }[] = [];
	const books = {
		seedChart: async () => undefined,
		chart: async () => ({ groups: GROUPS, ledgers: [...saved] }),
		saveLedger: vi.fn(async (ledger: (typeof saved)[number]) => void saved.push(ledger)),
		saveGroup: async () => undefined,
	};
	const templates = {
		booksSetUp: async () => false,
		startingChart: async () => ({ chart: { groups: [], ledgers: [] } }),
		installUnlocked: vi.fn(async () => undefined),
		library: async () => 'library',
	};
	const unused = {} as never;
	const service = new LedgerService(
		books as never,
		unused,
		unused,
		{ getProfile: async () => profile } as never,
		unused,
		unused,
		{ append: async () => undefined } as never,
		unused,
		unused,
		unused,
		unused,
		unused,
		unused,
		unused,
		unused,
		unused,
		unused,
		templates as never,
	);
	return { service, saved, books, templates };
}
const made = (saved: { name: string; groupId: string; roles: string[] }[]) =>
	saved.map((l) => [l.name, l.groupId, l.roles]);

describe('partners’ ledgers at set-up', () => {
	it('makes a firm’s partners their capital and, with fixed capital, current accounts, once', async () => {
		const { service, saved, templates } = build({
			kind: 'partnership',
			partnersCapital: 'fixed_with_current',
			partners: [
				{ id: 'Prt-01', name: 'Rina Das' },
				{ id: LONG_ID, name: 'Amit Sen' },
			],
		});
		expect(await service.setUpBooks('adm_owner')).toBe('library');
		expect(templates.installUnlocked).toHaveBeenCalledWith('adm_owner');
		const cut = `partner_capital_partner_${'9'.repeat(60)}`.slice(0, 60);
		expect(cut).toHaveLength(60);
		expect(made(saved)).toEqual([
			['Rina Das capital', 'grp_capital_account', ['partner_capital_prt_01']],
			['Rina Das current account', 'grp_partners_current', ['partner_current_prt_01']],
			['Amit Sen capital', 'grp_capital_account', [cut]],
			[
				'Amit Sen current account',
				'grp_partners_current',
				[`partner_current_partner_${'9'.repeat(60)}`.slice(0, 60)],
			],
		]);
		// Setting up again finds every one by its role.
		await service.setUpBooks('adm_owner');
		expect(saved).toHaveLength(4);
	});

	it('names an LLP’s capital its contribution, and makes no current account when capital fluctuates', async () => {
		const { service, saved } = build({
			kind: 'llp',
			partnersCapital: 'fluctuating',
			partners: [{ id: 'p1', name: 'Shreya Ghosh' }],
		});
		await service.setUpBooks(null);
		expect(made(saved)).toEqual([['Shreya Ghosh contribution', 'grp_capital_account', ['partner_capital_p1']]]);
	});

	it('makes nothing for a business with no profile yet, or one that has no partners', async () => {
		for (const profile of [null, { kind: 'proprietorship', partners: [{ id: 'p1', name: 'Owner' }] }]) {
			const { service, books } = build(profile);
			expect(await service.setUpBooks(null)).toBe('library');
			expect(books.saveLedger).not.toHaveBeenCalled();
		}
	});
});
