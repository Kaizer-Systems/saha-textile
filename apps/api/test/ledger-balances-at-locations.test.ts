import { describe, expect, it, vi } from 'vitest';

import { LedgerService } from '../src/ledger/ledger.service';

/** Balances on a day at chosen locations, never beyond the ones the person may see (reports by location, R1). */

const owner = { userId: 'adm_1', permissions: ['accounts.index'] } as never;

function build(scope: { all: boolean; ids: string[] }) {
	const books = { balancesAt: vi.fn(async (_day: string, ids: readonly string[]) => ({ led_cash: ids.length })) };
	const unused = {} as never;
	const service = new LedgerService(
		books as never,
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
		unused,
		unused,
		unused,
		unused,
		unused,
		{ scope: async () => scope } as never,
		unused,
	);
	return { service, books };
}

describe('balances at chosen locations', () => {
	it('reads every location the person may see when none is chosen', async () => {
		const { service, books } = build({ all: false, ids: ['loc_bar', 'loc_shop'] });
		await service.balancesAtLocations('2026-11-30', owner, []);
		expect(books.balancesAt).toHaveBeenCalledWith('2026-11-30', ['loc_bar', 'loc_shop']);
		const everyone = build({ all: true, ids: [] });
		await everyone.service.balancesAtLocations('2026-11-30', owner, []);
		expect(everyone.books.balancesAt).toHaveBeenCalledWith('2026-11-30', []);
	});

	it('keeps only the chosen locations the person may see, and gives nothing when none is left', async () => {
		const { service, books } = build({ all: false, ids: ['loc_bar'] });
		await service.balancesAtLocations('2026-11-30', owner, ['loc_bar', 'loc_tr']);
		expect(books.balancesAt).toHaveBeenCalledWith('2026-11-30', ['loc_bar']);
		expect(await service.balancesAtLocations('2026-11-30', owner, ['loc_tr'])).toEqual({});
		expect(books.balancesAt).toHaveBeenCalledTimes(1);
		const everyone = build({ all: true, ids: [] });
		await everyone.service.balancesAtLocations('2026-11-30', owner, ['loc_tr']);
		expect(everyone.books.balancesAt).toHaveBeenCalledWith('2026-11-30', ['loc_tr']);
	});
});
