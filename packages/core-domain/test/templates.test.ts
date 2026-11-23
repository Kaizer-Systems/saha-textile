import type { AccountsTemplate, ChartTemplateContent } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { defaultChart } from '../src/ledger/chart';
import {
	entriesOn,
	whatOpens,
	latestVersion,
	lockState,
	mergeCharts,
	starterChanges,
	unlockedFor,
	versionOn,
} from '../src/templates/rules';
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
		expect(templates.map((t) => t.code)).toEqual([
			'CH-COMMON',
			'CH-PROP',
			'CH-FIRM',
			'CH-LLP',
			'CH-OPC',
			'CH-PVT',
			'RS-RCM',
		]);
		expect(templates.every((t) => t.versions.every((v) => v.caReview === 'pending'))).toBe(true);
		const byCode = new Map(templates.map((t) => [t.code, t] as [string, AccountsTemplate]));
		const charts = templates.filter((t) => t.kind === 'chart');
		for (const [kind, code] of Object.entries(KIND_CHART_CODES)) {
			const merged = mergeCharts(
				unlockedFor(charts, kind as never).map((t) => t.versions[0]!.content as ChartTemplateContent),
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

	it('ships v2 charts with the expense ledgers every reverse-charge entry posts to, for each kind (D4)', () => {
		const templates = starterTemplates('2026-11-24T00:00:00.000Z');
		const rcm = templates.find((t) => t.code === 'RS-RCM')!;
		const entries = (rcm.versions[0]!.content as { entries: { expenseRole: string; kinds: string[] | null }[] })
			.entries;
		expect(byKey(templates, 'CH-PROP').versions.map((v) => v.version)).toEqual([1]);
		expect(byKey(templates, 'CH-PVT').versions.map((v) => v.version)).toEqual([1, 2]);
		for (const kind of Object.keys(KIND_CHART_CODES)) {
			const chart = mergeCharts(
				unlockedFor(
					templates.filter((t) => t.kind === 'chart'),
					kind as never,
				).map((t) => latestVersion(t).content as ChartTemplateContent),
			);
			const roles = new Set(chart.ledgers.flatMap((l) => l.roles));
			const needed = entries.filter((e) => e.kinds === null || e.kinds.includes(kind)).map((e) => e.expenseRole);
			expect(
				needed.filter((role) => !roles.has(role)),
				kind,
			).toEqual([]);
		}
	});

	it('adds missing starter templates and newer starter versions, never over a person’s own versions', () => {
		const at = '2026-11-25T00:00:00.000Z';
		const starters = starterTemplates(at);
		const v1Only = (code: string) => ({
			...byKey(starters, code),
			versions: [byKey(starters, code).versions[0]!],
			updatedAt: 'old',
		});
		const own = {
			...v1Only('CH-PVT'),
			versions: [{ ...byKey(starters, 'CH-PVT').versions[0]!, publishedBy: 'usr_ca' }],
		};
		const { inserts, updates } = starterChanges([v1Only('CH-COMMON'), own, byKey(starters, 'CH-PROP')], starters);
		expect(inserts.map((t) => t.code)).toEqual(['CH-FIRM', 'CH-LLP', 'CH-OPC', 'RS-RCM']);
		expect(
			updates.map((u) => [u.template.code, u.template.versions.map((v) => v.version), u.expectedUpdatedAt]),
		).toEqual([['CH-COMMON', [1, 2], 'old']]);
		expect(updates[0]?.template.updatedAt).toBe(at);
	});

	it('lists the entries of a rule set that apply to a kind on a day', () => {
		const entry = (key: string, kinds: string[] | null, from: string, to: string | null = null) =>
			({ key, kinds, from, to }) as never;
		const entries = [
			entry('rent', null, '2024-10-10'),
			entry('sponsorship', ['partnership', 'private_limited'], '2017-07-01'),
			entry('old', null, '2017-07-01', '2019-12-31'),
		];
		const keys = (kind: string, day: string) =>
			entriesOn(entries, kind as never, day).map((e) => (e as { key: string }).key);
		expect(keys('proprietorship', '2026-11-01')).toEqual(['rent']);
		expect(keys('private_limited', '2026-11-01')).toEqual(['rent', 'sponsorship']);
		expect(keys('proprietorship', '2019-06-01')).toEqual(['old']);
		expect(keys('proprietorship', '2024-10-09')).toEqual([]);
	});
});

describe('what a kind opens (AT1)', () => {
	it('lists the charts, tax rules and reports a kind unlocks, and how many stay locked', () => {
		const templates = starterTemplates('2026-11-24T00:00:00.000Z');
		const report = {
			...templates[0]!,
			code: 'RP-NCE-BS',
			name: 'Balance sheet',
			kind: 'report' as const,
			versions: [{ ...templates[0]!.versions[0]!, content: { kind: 'report' as const, lines: [] } }],
		};
		const opens = whatOpens([...templates, report], 'proprietorship', '2026-11-24');
		expect(opens.charts).toEqual([
			{ code: 'CH-COMMON', name: 'Shared chart', version: 2 },
			{ code: 'CH-PROP', name: "Proprietor's capital and drawings", version: 1 },
		]);
		expect(opens.taxRules).toEqual([{ code: 'RS-RCM', name: 'Reverse-charge list', version: 1, entries: 4 }]);
		expect(opens.reports).toEqual([{ code: 'RP-NCE-BS', name: 'Balance sheet', version: 1 }]);
		expect(opens.locked).toBe(4);
		expect(whatOpens(templates, 'private_limited', '2026-11-24').taxRules[0]?.entries).toBe(6);
	});
});

const byKey = (templates: AccountsTemplate[], code: string): AccountsTemplate =>
	templates.find((t) => t.code === code)!;
