import { type ShopDetailsImpact, type ShopDetailsView, gstinCheckCharacter } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	type ShopForm,
	cleanShopGstin,
	sameShopForm,
	shopChangeNeedsConfirm,
	shopFormOf,
	shopFormProblems,
	shopGstinVerdict,
} from './shop-details';

const gstin = (state: string, entity = '1') => {
	const first14 = `${state}AAPFS4821K${entity}Z`;
	return first14 + gstinCheckCharacter(first14);
};

const view = (overrides: Partial<ShopDetailsView> = {}): ShopDetailsView => ({
	legalName: 'Saha Textile',
	tradeName: '',
	gstin: gstin('19'),
	address: '14 Hazra Road, Kalighat',
	city: 'Kolkata',
	pin: '700026',
	phone: '',
	email: '',
	updatedAt: '2026-11-16T13:10:00.000Z',
	updatedBy: 'adm_owner',
	stateCode: '19',
	stateName: 'West Bengal',
	pan: 'AAPFS4821K',
	homeStateCode: '19',
	homeStateName: 'West Bengal',
	missing: [],
	canEdit: true,
	updatedByName: 'Moulik',
	logoUrl: null,
	brandShopName: 'Saha Textile',
	...overrides,
});

const form = (overrides: Partial<ShopForm> = {}): ShopForm => ({ ...shopFormOf(view()), ...overrides });

const impact = (overrides: Partial<ShopDetailsImpact> = {}): ShopDetailsImpact => ({
	problem: null,
	expectedLastCharacter: null,
	pan: 'AAPFS4821K',
	stateFrom: { code: '19', name: 'West Bengal' },
	stateTo: { code: '27', name: 'Maharashtra' },
	stateChanges: true,
	toIntraState: [],
	toInterState: [],
	...overrides,
});

const ok = { kind: 'ok', stateCode: '19', stateName: 'West Bengal', pan: 'AAPFS4821K' } as const;
const problems = (value: ShopForm) =>
	shopFormProblems(value, value.gstin.length === 15 ? ok : shopGstinVerdict(value.gstin, null, null));

describe('settings › shop details (x04–x04d)', () => {
	it('reads the saved GSTIN from the record and any other from the server check of that exact value', () => {
		const saved = view();
		expect(shopGstinVerdict('', saved, null)).toEqual({ kind: 'empty' });
		expect(shopGstinVerdict('19AAPFS', saved, null)).toEqual({ kind: 'typing' });
		expect(shopGstinVerdict(gstin('19').toLowerCase(), saved, null)).toEqual({
			kind: 'ok',
			stateCode: '19',
			stateName: 'West Bengal',
			pan: 'AAPFS4821K',
		});
		const other = gstin('27');
		expect(shopGstinVerdict(other, saved, null)).toEqual({ kind: 'checking' });
		expect(shopGstinVerdict(other, saved, { gstin: gstin('29'), result: impact() })).toEqual({ kind: 'checking' });
		expect(shopGstinVerdict(other, saved, { gstin: other, result: 'failed' })).toEqual({ kind: 'unchecked' });
		expect(shopGstinVerdict(other, saved, { gstin: other, result: impact() })).toEqual({
			kind: 'ok',
			stateCode: '27',
			stateName: 'Maharashtra',
			pan: 'AAPFS4821K',
		});
		const wrong = other.slice(0, 14) + 'Q';
		expect(
			shopGstinVerdict(wrong, saved, {
				gstin: wrong,
				result: impact({ problem: 'check_digit', expectedLastCharacter: 'M', stateTo: null }),
			}),
		).toEqual({ kind: 'problem', key: 'shop_gstin_check_digit_wrong', params: { expected: 'M' } });
		expect(
			shopGstinVerdict(wrong, saved, { gstin: wrong, result: impact({ problem: 'state', stateTo: null }) }),
		).toMatchObject({ key: 'shop_gstin_state_unknown' });
		expect(shopGstinVerdict(`${other}X`, saved, null)).toMatchObject({ key: 'gstin_shape_wrong' });
		expect(cleanShopGstin(' 19aapf s4821k1zm ')).toBe('19AAPFS4821K1ZM');
	});

	it('needs the starred rows, a 6-digit PIN, and a phone or email only when well formed', () => {
		expect(problems(form())).toEqual({});
		expect(problems(form({ legalName: ' ', city: '', gstin: '' }))).toEqual({
			legalName: 'shop_field_required',
			city: 'shop_field_required',
			gstin: 'shop_field_required',
		});
		expect(problems(form({ gstin: '19AAP' })).gstin).toBe('gstin_shape_wrong');
		expect(problems(form({ pin: '70026' })).pin).toBe('shop_pin_shape');
		expect(problems(form({ pin: '070026' })).pin).toBe('shop_pin_shape');
		expect(problems(form({ phone: '+91 33 4000 0000', email: 'accounts@shop.example.test' }))).toEqual({});
		expect(problems(form({ phone: '4000' })).phone).toBe('shop_phone_shape');
		expect(problems(form({ phone: 'call the office' })).phone).toBe('shop_phone_shape');
		expect(problems(form({ email: 'accounts@shop' })).email).toBe('invalid_email');
	});

	it('treats spacing and letter case in the GSTIN as no change', () => {
		expect(sameShopForm(form(), form({ gstin: gstin('19').toLowerCase() }))).toBe(true);
		expect(sameShopForm(form(), form({ city: 'Kolkata ' }))).toBe(true);
		expect(sameShopForm(form(), form({ phone: '+91 33 4000 0000' }))).toBe(false);
	});

	it('confirms a new GSTIN or legal name, and a first GSTIN only when it moves the State', () => {
		const saved = view();
		expect(shopChangeNeedsConfirm(saved, form({ address: '15 Hazra Road' }))).toBe(false);
		expect(shopChangeNeedsConfirm(saved, form({ gstin: gstin('19', '2') }))).toBe(true);
		expect(shopChangeNeedsConfirm(saved, form({ legalName: 'Saha Textile Private Limited' }))).toBe(true);
		const empty = view({ gstin: null, legalName: '', stateCode: null, pan: null });
		expect(shopChangeNeedsConfirm(empty, form())).toBe(false);
		expect(shopChangeNeedsConfirm(empty, form({ gstin: gstin('27') }))).toBe(true);
	});
});
