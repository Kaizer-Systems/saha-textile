import type { AccountsTemplate, ChartTemplateContent } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { defaultChart } from '../src/ledger/chart';
import { latestVersion, lockState, mergeCharts, unlockedFor, versionOn } from '../src/templates/rules';
import { KIND_CHART_CODES, starterTemplates } from '../src/templates/starter';

const version = (v: number, validFrom: string, validTo: string | null = null) =>
	({ version: v, validFrom, validTo, content: { kind: 'chart', groups: [], ledgers: [] } }) as never;

describe('accounts templates (T2)', () => {
	it('opens shared templates and the company’s own kind; locks the rest with the reason', () => {
		expect(lockState({ appliesTo: { all: true, kinds: [] } }, 'llp')).toEqual({ locked: false, lockReason: null });
		expect(lockState({ appliesTo: { all: false, kinds: ['llp'] } }, 'llp').locked).toBe(false);
		expect(lockState({ appliesTo: { all: false, kinds: ['partnership'] } }, 'llp')).toEqual({
			locked: true,
			lockReason: 'not_this_kind',
		});
		const list = [
			{ code: 'CH-FIRM', appliesTo: { all: false, kinds: ['partnership' as const] } },
			{ code: 'CH-PROP', appliesTo: { all: false, kinds: ['proprietorship' as const] } },
			{ code: 'CH-COMMON', appliesTo: { all: true, kinds: [] } },
		];
		expect(unlockedFor(list, 'proprietorship').map((t) => t.code)).toEqual(['CH-COMMON', 'CH-PROP']);
	});

	it('finds the newest version, and the version in force on a day', () => {
		const template = {
			versions: [version(1, '2017-07-01', '2024-10-09'), version(3, '2026-04-01'), version(2, '2024-10-10')],
		};
		expect(latestVersion(template).version).toBe(3);
		expect(versionOn(template, '2020-01-01')?.version).toBe(1);
		expect(versionOn(template, '2025-01-01')?.version).toBe(2);
		expect(versionOn(template, '2026-11-24')?.version).toBe(3);
		expect(versionOn(template, '2016-01-01')).toBeNull();
		expect(
			versionOn({ versions: [version(2, '2024-10-10'), version(4, '2026-04-01')] }, '2026-11-24')?.version,
		).toBe(4);
	});

	it('merges shared and own charts, refusing a key defined twice or pointing nowhere', () => {
		const chart = (groups: object[], ledgers: object[]) =>
			({ kind: 'chart', groups, ledgers }) as ChartTemplateContent;
		const shared = chart(
			[{ key: 'current_assets', parentKey: null }],
			[{ key: 'cash', groupKey: 'current_assets' }],
		);
		const own = chart(
			[{ key: 'capital_account', parentKey: null }],
			[{ key: 'drawings', groupKey: 'capital_account' }],
		);
		expect(mergeCharts([shared, own]).ledgers.map((l) => l.key)).toEqual(['cash', 'drawings']);
		expect(() => mergeCharts([shared, shared])).toThrow('template_duplicate_key:current_assets');
		expect(() => mergeCharts([chart([{ key: 'a', parentKey: 'b' }], [])])).toThrow('template_unknown_parent:a');
		expect(() => mergeCharts([chart([], [{ key: 'x', groupKey: 'nowhere' }])])).toThrow('template_unknown_group:x');
	});

	it('starts from today’s chart: one shared template and one per kind that rebuild each kind’s chart exactly', () => {
		const templates = starterTemplates('2026-11-24T00:00:00.000Z');
		expect(templates.map((t) => t.code)).toEqual(['CH-COMMON', 'CH-PROP', 'CH-FIRM', 'CH-LLP', 'CH-OPC', 'CH-PVT']);
		expect(templates.every((t) => t.versions[0]?.caReview === 'pending')).toBe(true);
		const byCode = new Map(templates.map((t) => [t.code, t] as [string, AccountsTemplate]));
		for (const [kind, code] of Object.entries(KIND_CHART_CODES)) {
			const merged = mergeCharts(
				unlockedFor(templates, kind as never).map((t) => t.versions[0]!.content as ChartTemplateContent),
			);
			const expected = defaultChart(kind as never);
			expect(merged.groups.map((g) => g.key).sort()).toEqual(expected.groups.map((g) => g.systemKey).sort());
			expect(merged.ledgers.map((l) => l.key).sort()).toEqual(expected.ledgers.map((l) => l.systemKey).sort());
			expect(byCode.get(code)?.appliesTo).toEqual({ all: false, kinds: [kind] });
		}
		const common = byCode.get('CH-COMMON')!.versions[0]!.content as ChartTemplateContent;
		expect(common.ledgers.find((l) => l.key === 'customer_advances')?.roles).toEqual(['customer_advances']);
		expect(common.groups.some((g) => g.key === 'capital_account')).toBe(false);
	});
});
