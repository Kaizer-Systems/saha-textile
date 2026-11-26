import { describe, expect, it } from 'vitest';

import { entriesOn, latestVersion, publishProblems } from '../src/templates/rules';
import { KIND_PACKS, LIMITS, STARTER_REPORTS, TDS_SECTIONS } from '../src/templates/starter-packs';
import { starterTemplates } from '../src/templates/starter';

/** The starter packs for every kind of business (accounts templates plan T8). */

const now = '2026-11-24T08:00:00.000Z';
const library = starterTemplates(now);

describe('the starter packs (T8)', () => {
	it('each passes the checks a person publishing it would face', () => {
		for (const template of library) {
			const latest = latestVersion(template);
			const asDraft = {
				...template,
				draft: {
					content: latest.content,
					validFrom: '2099-01-01',
					source: '',
					notes: '',
					savedAt: now,
					savedBy: null,
				},
			};
			expect(publishProblems(asDraft, library), template.code).toEqual([]);
		}
	});

	it('gives every kind its own groups and ledgers, each statement to its kinds, and every rule its source and review', () => {
		expect(KIND_PACKS.partnership.ledgers.map((l) => l.key)).toEqual([
			'drawings',
			'loans_from_partners',
			'interest_on_partners_capital',
			'partners_remuneration',
		]);
		expect(KIND_PACKS.llp.groups.map((g) => g.key)).toEqual(['appropriation', 'reserves_and_surplus']);
		expect(KIND_PACKS.private_limited.ledgers).toEqual(KIND_PACKS.private_limited_opc.ledgers);
		expect(STARTER_REPORTS.filter((r) => r.kinds.includes('llp')).map((r) => r.code)).toEqual([
			'RP-APPROP',
			'RP-LLP-BS',
			'RP-LLP-PL',
		]);
		for (const entry of [...TDS_SECTIONS.entries, ...LIMITS.entries]) {
			expect(entry.limitINR, entry.key).not.toBeNull();
			expect(entry.source, entry.key).not.toBe('');
			expect(entry.caReview).toBe('pending');
		}
	});

	it('changes TDS section numbers on 1 April 2026, and keeps partner payments to firms and LLPs', () => {
		const sections = (kind: 'proprietorship' | 'llp', day: string) =>
			entriesOn(TDS_SECTIONS.entries, kind, day).map((e) => e.code);
		expect(new Set(sections('proprietorship', '2026-03-31'))).toEqual(
			new Set(['194C', '194J', '194-I', '194H', '194Q']),
		);
		expect(new Set(sections('proprietorship', '2026-04-01'))).toEqual(new Set(['393']));
		expect(entriesOn(TDS_SECTIONS.entries, 'llp', '2026-05-01').map((e) => e.key)).toContain('partner_payments');
		expect(entriesOn(TDS_SECTIONS.entries, 'proprietorship', '2026-05-01').map((e) => e.key)).not.toContain(
			'partner_payments',
		);
	});
});
