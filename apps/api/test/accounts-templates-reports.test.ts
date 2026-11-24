import { describe, expect, it } from 'vitest';

import { AccountsTemplatesService } from '../src/accounts-templates/accounts-templates.service';

import { memoryTemplateStores } from './accounts-templates-memory';

/** The report layouts installed for the company, each at its installed version (accounts brief R1, U2). */

const at = '2026-11-24T10:00:00.000Z';
const install = (code: string, version: number) => ({ code, version, installedAt: at, installedBy: null });

describe('the installed report layouts', () => {
	it('gives each installed report at its version, skipping other kinds and installs whose template or version is gone', async () => {
		const stores = memoryTemplateStores([], [
			install('RP-SCH3-BS', 1),
			// A tax rule set, not a report.
			install('RS-RCM', 1),
			install('RP-GONE', 1),
			install('RP-SCH3-PL', 9),
		] as never[]);
		const service = new AccountsTemplatesService(stores.templates, stores.installs, {
			getProfile: async () => null,
		} as never);
		const reports = await service.installedReports();
		expect(reports.map((r) => [r.code, r.version, r.content.kind])).toEqual([['RP-SCH3-BS', 1, 'report']]);
		expect(reports[0]?.name).toBe(stores.templates.rows.find((t) => t.code === 'RP-SCH3-BS')?.name);
		expect(reports[0]?.content.lines.length).toBeGreaterThan(0);
	});
});
