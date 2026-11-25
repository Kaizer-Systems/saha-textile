import type { CompanyProfile } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	appropriate,
	companyProblems,
	kindEffects,
	partnerRemunerationLimitINR,
	switchRefusals,
	termsOn,
	termsProblems,
	turnoverChecks,
} from '../src/company/company-rules';

const profile = (overrides: Partial<CompanyProfile>): CompanyProfile => ({
	kind: 'private_limited',
	legalName: '',
	tradeName: '',
	pan: null,
	tan: null,
	cin: null,
	llpin: null,
	udyam: null,
	financialYearStartMonth: 4,
	booksStartOn: null,
	homeCurrency: 'INR',
	proprietor: null,
	otherBusinesses: [],
	partners: [],
	partnersCapital: 'fixed_with_current',
	deedFrom: null,
	interestBasis: 'daily',
	lossYearCharges: false,
	earlierDeeds: [],
	directors: [],
	shareholders: [],
	authorisedCapitalINR: 0,
	paidUpCapitalINR: 0,
	faceValueINR: 10,
	nomineeName: null,
	revision: 0,
	updatedAt: null,
	updatedBy: null,
	...overrides,
});

const partner = (id: string, over = {}) => ({
	id,
	name: id,
	pan: 'ABCPS1234D',
	working: true,
	capitalINR: 0,
	profitSharePercent: 50,
	interestOnCapitalPercent: 0,
	monthlyRemunerationINR: 0,
	remunerationBasis: 'monthly' as const,
	remunerationPercent: 0,
	designated: false,
	dpin: null,
	...over,
});

describe('company setup rules (accounts brief CT, owner-approved 2026-11-23)', () => {
	it('asks each kind of business for what it needs', () => {
		expect(companyProblems(profile({ kind: 'proprietorship' }))).toEqual(['proprietor_needed']);
		expect(
			companyProblems(profile({ kind: 'partnership', partners: [partner('a', { profitSharePercent: 60 })] })),
		).toEqual(['partners_two_or_more', 'partner_shares_total_100']);
		expect(
			companyProblems(
				profile({
					kind: 'llp',
					llpin: 'AAA-0000',
					partners: [partner('a', { designated: true }), partner('b')],
				}),
			),
		).toEqual(['llp_two_designated_partners']);
		expect(companyProblems(profile({ kind: 'private_limited_opc', cin: null }))).toEqual([
			'opc_one_shareholder',
			'opc_nominee_needed',
			'company_one_director',
			'cin_needed',
		]);
		expect(
			companyProblems(
				profile({
					kind: 'private_limited',
					cin: 'U17299WB2024PTC000000',
					authorisedCapitalINR: 1000,
					paidUpCapitalINR: 2000,
				}),
			),
		).toEqual(['company_two_directors', 'paid_up_over_authorised']);
	});

	it('accepts complete ownership records and distinguishes missing LLP and company identifiers', () => {
		const proprietor = { name: 'Example owner', pan: 'ABCPS1234D', openingCapitalINR: 0 };
		const director = {
			id: 'director-1',
			name: 'Example director',
			din: '12345678',
			since: '2026-04-01',
			paidAs: 'none',
		} as const;
		const shareholders = [{ id: 'shareholder-1', name: 'Example shareholder', shares: 1 }];
		const partners = [partner('first', { designated: true }), partner('second', { designated: true })];
		expect(companyProblems(profile({ kind: 'proprietorship', proprietor }))).toEqual([]);
		expect(companyProblems(profile({ kind: 'partnership', partners }))).toEqual([]);
		expect(companyProblems(profile({ kind: 'partnership' }))).toEqual(['partners_two_or_more']);
		expect(companyProblems(profile({ kind: 'llp', partners, llpin: 'AAA-0000' }))).toEqual([]);
		expect(companyProblems(profile({ kind: 'llp' }))).toEqual([
			'partners_two_or_more',
			'llp_two_designated_partners',
			'llpin_needed',
		]);
		expect(companyProblems(profile({ kind: 'llp', partners: [partner('first')], llpin: 'AAA-0000' }))).toContain(
			'partner_shares_total_100',
		);
		expect(
			companyProblems(
				profile({
					kind: 'private_limited_opc',
					cin: 'U17299WB2024PTC000000',
					shareholders,
					directors: [director],
					nomineeName: 'Example nominee',
				}),
			),
		).toEqual([]);
		expect(companyProblems(profile({ directors: [director, { ...director, id: 'director-2' }] }))).toEqual([
			'cin_needed',
		]);
	});

	it('says what each kind changes (CT6)', () => {
		expect(kindEffects('proprietorship')).toMatchObject({
			ownersAccounts: 'capital_and_drawings',
			incomeTaxReturn: 'ITR-3',
			ownersPaidAs: 'drawings',
		});
		expect(kindEffects('partnership').incomeTaxReturn).toBe('ITR-5');
		expect(kindEffects('llp').statements).toBe('llp');
		expect(kindEffects('private_limited_opc')).toEqual(kindEffects('private_limited'));
		expect(kindEffects('private_limited')).toMatchObject({
			statements: 'schedule_iii',
			depreciationBooks: ['companies_act', 'income_tax'],
			companiesActAuditTrail: true,
		});
	});

	it('works out the s.40(b) remuneration limit and the year-end sharing (CT7 example)', () => {
		expect(partnerRemunerationLimitINR(-50_000)).toBe(300_000);
		expect(partnerRemunerationLimitINR(200_000)).toBe(300_000);
		expect(partnerRemunerationLimitINR(1_620_000)).toBe(1_152_000);
		const result = appropriate(
			{
				partners: [
					partner('arindam', {
						capitalINR: 1_000_000,
						profitSharePercent: 60,
						interestOnCapitalPercent: 12,
						monthlyRemunerationINR: 60_000,
					}),
					partner('rupa', {
						capitalINR: 500_000,
						profitSharePercent: 40,
						interestOnCapitalPercent: 12,
						monthlyRemunerationINR: 40_000,
					}),
				],
			},
			1_800_000,
		);
		expect(
			result.partners.map((row) => [row.interestINR, row.remunerationINR, row.shareINR, row.toCurrentINR]),
		).toEqual([
			[120_000, 720_000, 252_000, 1_092_000],
			[60_000, 480_000, 168_000, 708_000],
		]);
		expect(result.remunerationLimitINR).toBe(1_152_000);
		expect(result.remunerationDisallowedINR).toBe(48_000);
		expect(result.interestDisallowedINR).toBe(0);
	});

	it('does not pay a non-working partner remuneration and separates disallowed interest', () => {
		const result = appropriate(
			{
				partners: [
					partner('first', {
						working: false,
						capitalINR: 100_000,
						interestOnCapitalPercent: 15,
						monthlyRemunerationINR: 10_000,
						profitSharePercent: 100,
					}),
				],
			},
			5_000,
		);
		expect(result.partners).toEqual([
			{ id: 'first', interestINR: 15_000, remunerationINR: 0, shareINR: -10_000, toCurrentINR: 5_000 },
		]);
		expect(result.interestDisallowedINR).toBe(3_000);
		expect(result.remunerationDisallowedINR).toBe(0);
	});

	it('sets GST checks from turnover, with the lower composition limit in Tripura (G1, G2)', () => {
		expect(turnoverChecks(24_860_000, '19')).toEqual({
			eInvoice: false,
			eInvoiceThirtyDays: false,
			annualReturn: true,
			reconciliationStatement: false,
			hsnDigits: 4,
			qrmpAllowed: true,
			compositionAllowed: false,
		});
		expect(turnoverChecks(64_000_000, '19')).toMatchObject({
			eInvoice: true,
			hsnDigits: 6,
			qrmpAllowed: false,
			reconciliationStatement: true,
		});
		expect(turnoverChecks(10_000_000, '16').compositionAllowed).toBe(false);
		expect(turnoverChecks(10_000_000, '19').compositionAllowed).toBe(true);
	});

	it('refuses terms that break the scheme rules, and finds the terms in force on a day', () => {
		const base = {
			kind: 'regular',
			scheme: 'monthly',
			compositionRatePercent: null,
			lastYearTurnoverINR: 0,
			eInvoice: false,
			eInvoiceThirtyDays: false,
			annualReturn: true,
			reconciliationStatement: false,
			hsnDigits: 4,
		} as const;
		expect(
			termsProblems({ ...base, from: '2026-04-01', scheme: 'qrmp', lastYearTurnoverINR: 60_000_000 }, '19'),
		).toEqual(['qrmp_over_limit']);
		expect(termsProblems({ ...base, from: '2026-04-01', kind: 'composition' }, '19')).toEqual([
			'composition_rate_needed',
		]);
		expect(termsProblems({ ...base, from: '2026-04-01', kind: 'isd', scheme: 'qrmp' }, '19')).toEqual([
			'isd_monthly_only',
		]);
		expect(
			termsProblems(
				{
					...base,
					from: '2026-04-01',
					kind: 'composition',
					compositionRatePercent: 1,
					lastYearTurnoverINR: 7_500_001,
				},
				'16',
			),
		).toEqual(['composition_over_limit']);
		expect(termsProblems({ ...base, from: '2026-04-01', kind: 'isd' }, '19')).toEqual([]);
		const registration = {
			terms: [
				{ ...base, from: '2026-04-01' },
				{ ...base, from: '2026-10-01', scheme: 'qrmp' as const },
			],
		};
		expect(termsOn(registration, '2026-09-30')?.scheme).toBe('monthly');
		expect(termsOn(registration, '2026-11-23')?.scheme).toBe('qrmp');
		expect(termsOn(registration, '2026-03-31')).toBeNull();
		expect(termsOn({ terms: [...registration.terms].reverse() }, '2026-11-23')?.scheme).toBe('qrmp');
	});

	it('refuses switching off a feature in use, or on without what it needs (J3)', () => {
		expect(switchRefusals({ locations: false }, { locations: true }, { locations: 4 })).toEqual([
			{ key: 'locations', reason: 'in_use', count: 4 },
		]);
		expect(switchRefusals({ stores: true }, { locations: false }, {})).toEqual([
			{ key: 'stores', reason: 'needs', needs: 'locations' },
		]);
		expect(switchRefusals({ stores: true, locations: true }, {}, {})).toEqual([]);
		expect(switchRefusals({ pf: false }, { pf: true }, {})).toEqual([]);
		expect(switchRefusals({ stores: true }, { locations: true }, {})).toEqual([]);
		expect(switchRefusals({ stores: true, locations: false }, { locations: true }, {})).toEqual([
			{ key: 'stores', reason: 'needs', needs: 'locations' },
		]);
	});
});
