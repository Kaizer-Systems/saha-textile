import type { AccountsTemplate } from '@saha-textile/contracts';
import { DUE_DATES } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { AccountsTemplatesService } from '../src/accounts-templates/accounts-templates.service';

import { memoryTemplateStores } from './accounts-templates-memory';

/** A tax rule set's entries on a day, from the version installed (accounts templates T2; RS-DUE for GST due dates). */

const at = '2026-11-24T10:00:00.000Z';
const serviceFor = (rows: AccountsTemplate[] = [], installs = [] as never[]) => {
	const stores = memoryTemplateStores(rows, installs);
	return {
		stores,
		service: new AccountsTemplatesService(stores.templates, stores.installs, {
			getProfile: async () => null,
		} as never),
	};
};

/** A template that is not a tax rule set (a statement layout). */
const layout: AccountsTemplate = {
	id: 'tpl_rs_layout',
	code: 'RS-LAYOUT',
	kind: 'report',
	name: 'A layout',
	description: '',
	appliesTo: { all: true, kinds: [] },
	draft: null,
	versions: [
		{
			version: 1,
			validFrom: '2017-07-01',
			validTo: null,
			source: '',
			caReview: 'pending',
			notes: '',
			content: { kind: 'report', columns: 'thisAndLast', notes: false, level: null, lines: [] },
			publishedAt: at,
			publishedBy: 'usr_ca',
		},
	],
	createdAt: at,
	updatedAt: at,
};

describe('a tax rule set’s entries on a day', () => {
	it('reads the starter due-date rules from the version installed, installing the newest the first time', async () => {
		const { service, stores } = serviceFor();
		expect(await service.ruleSetEntries('RS-DUE', '2026-11-28')).toEqual(DUE_DATES.entries);
		expect(stores.installs.rows.map((i) => [i.code, i.version])).toEqual([['RS-DUE', 1]]);
		// A day before the set's first version has none.
		expect(await service.ruleSetEntries('RS-DUE', '2017-06-30')).toEqual([]);
	});

	it('gives nothing for a set that doesn’t exist, one installed at no version, or a template that isn’t tax rules', async () => {
		expect(await serviceFor().service.ruleSetEntries('RS-NONE', '2026-11-28')).toEqual([]);
		const notInstalled = serviceFor([], [
			{ code: 'RS-DUE', version: 0, installedAt: at, installedBy: null },
		] as never[]);
		expect(await notInstalled.service.ruleSetEntries('RS-DUE', '2026-11-28')).toEqual([]);
		expect(await serviceFor([layout]).service.ruleSetEntries('RS-LAYOUT', '2026-11-28')).toEqual([]);
	});
});
