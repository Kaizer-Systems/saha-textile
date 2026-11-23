import { describe, expect, it } from 'vitest';

import { chartChanges, publishDraft, publishProblems, published, whatOpens } from '../src/templates/rules';
import { starterTemplates } from '../src/templates/starter';

import type { AccountsTemplate, ChartTemplateContent } from '@saha-textile/contracts';

/** The template builder (accounts templates plan AT2, AT3): drafts, the publishing checks and Publish. */

const now = '2026-11-24T08:00:00.000Z';
const library = starterTemplates(now);
const byCode = (code: string) => library.find((t) => t.code === code) as AccountsTemplate;
const latestChart = (code: string) => {
	const t = byCode(code);
	return t.versions[t.versions.length - 1]?.content as ChartTemplateContent;
};
const draftOf = (template: AccountsTemplate, content: unknown, validFrom = '2026-12-01'): AccountsTemplate => ({
	...template,
	draft: {
		content: content as ChartTemplateContent,
		validFrom,
		source: 'Deed clause 7',
		notes: '',
		savedAt: now,
		savedBy: null,
	},
});
const ledger = (key: string, groupKey: string, roles: string[] = []) => ({
	key,
	name: key,
	groupKey,
	handPosting: true,
	roles,
	ruleSetCode: null,
	source: '',
});

describe('templates only drafted', () => {
	it('are used by nothing until published', () => {
		const fresh: AccountsTemplate = { ...byCode('CH-FIRM'), code: 'CH-FIRM-X', versions: [] };
		expect(published([...library, fresh]).map((t) => t.code)).not.toContain('CH-FIRM-X');
		expect(whatOpens([...library, fresh], 'partnership', '2026-11-24').charts.map((c) => c.code)).toEqual([
			'CH-COMMON',
			'CH-FIRM',
		]);
	});
});

describe('the publishing checks (AT3)', () => {
	it('passes a whole chart that starts after the newest version', () => {
		const firm = byCode('CH-FIRM');
		const content = latestChart('CH-FIRM');
		const more = { ...content, ledgers: [...content.ledgers, ledger('loans_from_partners', 'capital_account')] };
		expect(publishProblems(draftOf(firm, more), library)).toEqual([]);
	});

	it('wants a draft, of the template’s type, after the newest version', () => {
		expect(publishProblems(byCode('CH-FIRM'), library)).toEqual(['template_no_draft']);
		const rcm = byCode('RS-RCM');
		expect(
			publishProblems(draftOf(rcm, { kind: 'chart', groups: [], ledgers: [] }, '2017-07-01'), library),
		).toEqual(['template_wrong_kind', 'template_dates_overlap']);
		expect(publishProblems(draftOf(rcm, { kind: 'taxRules', entries: [] }, '2027-01-01'), library)).toEqual([]);
	});

	it('names a broken chart, a role no ledger plays, and a role played twice, for each kind', () => {
		const prop = byCode('CH-PROP');
		const content = latestChart('CH-PROP');
		const lost = { ...content, ledgers: [...content.ledgers, ledger('stray', 'nowhere')] };
		expect(publishProblems(draftOf(prop, lost), library)).toEqual(['template_unknown_group:stray']);
		const twice = { ...content, ledgers: [...content.ledgers, ledger('till_cash', 'cash_in_hand', ['cash'])] };
		expect(publishProblems(draftOf(prop, twice), library)).toEqual(['template_role_ambiguous:cash']);
		const common = byCode('CH-COMMON');
		const shared = latestChart('CH-COMMON');
		const noCash = { ...shared, ledgers: shared.ledgers.filter((l) => l.key !== 'cash') };
		const problems = publishProblems(draftOf(common, noCash), library);
		expect(problems).toContain('template_role_missing:cash:proprietorship');
		expect(problems).toContain('template_role_missing:cash:private_limited');
	});

	it('checks a brand-new chart against what each of its kinds opens', () => {
		const fresh: AccountsTemplate = {
			...byCode('CH-FIRM'),
			code: 'CH-FIRM-NEW',
			versions: [],
			appliesTo: { all: false, kinds: ['partnership'] },
		};
		const content = { kind: 'chart', groups: [], ledgers: [ledger('partner_b', 'capital_account')] };
		expect(publishProblems(draftOf(fresh, content), [...library, fresh])).toEqual([]);
	});
});

describe('changes from the newest version', () => {
	it('lists what the draft adds, removes and renames', () => {
		const before = latestChart('CH-PROP');
		const after = {
			...before,
			ledgers: [
				...before.ledgers
					.filter((l) => l.key !== 'drawings')
					.map((l) => (l.key === 'capital' ? { ...l, name: 'Owner capital' } : l)),
				ledger('interest_on_capital', 'capital_account'),
			],
		};
		expect(chartChanges(before, after)).toEqual({
			added: ['interest_on_capital'],
			removed: ['Drawings'],
			renamed: ['Owner capital'],
		});
		expect(chartChanges(null, { kind: 'chart', groups: [], ledgers: [ledger('x', 'g')] }).added).toEqual(['x']);
	});
});

describe('Publish', () => {
	it('turns the draft into the next version, ending the one before the day before', () => {
		const firm = byCode('CH-FIRM');
		const published1 = publishDraft(draftOf(firm, latestChart('CH-FIRM'), '2027-04-01'), 'adm_owner', now);
		expect(published1.draft).toBeNull();
		expect(published1.versions.map((v) => [v.version, v.validFrom, v.validTo, v.publishedBy])).toEqual([
			[1, firm.versions[0]?.validFrom, '2027-03-31', null],
			[2, '2027-04-01', null, 'adm_owner'],
		]);
		const first = publishDraft(draftOf({ ...firm, versions: [] }, latestChart('CH-FIRM')), null, now);
		expect(first.versions.map((v) => v.version)).toEqual([1]);
		expect(publishDraft(firm, null, now)).toBe(firm);
		const ended = publishDraft(
			draftOf(
				{
					...firm,
					versions: [
						{ ...(firm.versions[0] as never), validTo: '2026-01-31' },
						{ ...(firm.versions[0] as never), version: 2, validFrom: '2028-01-01' },
					],
				},
				latestChart('CH-FIRM'),
				'2027-04-01',
			),
			null,
			now,
		);
		expect(ended.versions.map((v) => v.validTo)).toEqual(['2026-01-31', null, null]);
	});
});
