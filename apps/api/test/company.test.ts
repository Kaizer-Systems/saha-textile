import { ForbiddenException } from '@nestjs/common';
import {
	CompanyProfile,
	gstinCheckCharacter,
	type CompanyProfileWrite,
	type FeatureSwitches,
	type GstRegistration,
} from '@saha-textile/contracts';
import type { CompanyRepository, ShopDetailsRepository } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { CompanyService } from '../src/company/company.service';

class MemoryCompany implements CompanyRepository {
	profile: CompanyProfile | null = null;
	features: FeatureSwitches | null = null;
	regs = new Map<string, GstRegistration>();
	async getProfile() {
		return this.profile;
	}
	async saveProfile(p: CompanyProfile) {
		this.profile = p;
	}
	async listRegistrations() {
		return [...this.regs.values()];
	}
	async getRegistration(id: string) {
		return this.regs.get(id) ?? null;
	}
	async findRegistrationByGstin(gstin: string) {
		return [...this.regs.values()].find((r) => r.gstin === gstin) ?? null;
	}
	async saveRegistration(r: GstRegistration) {
		this.regs.set(r.id, r);
	}
	async getFeatures() {
		return this.features;
	}
	async saveFeatures(f: FeatureSwitches) {
		this.features = f;
	}
}
const shop = (gstin: string | null): ShopDetailsRepository => ({
	get: async () => ({ legalName: 'Shop Legal', tradeName: 'Shop', gstin }) as never,
	save: async () => undefined,
});
const GSTIN = `19AAPFU0939F1Z${gstinCheckCharacter('19AAPFU0939F1Z')}`;
const terms = {
	from: '2026-04-01',
	kind: 'regular',
	scheme: 'monthly',
	compositionRatePercent: null,
	lastYearTurnoverINR: 24_860_000,
	eInvoice: false,
	eInvoiceThirtyDays: false,
	annualReturn: true,
	reconciliationStatement: false,
	hsnDigits: 4,
} as const;

describe('Settings › Company (accounts brief J, CT, G1–G2)', () => {
	it('starts from Shop details until a profile is saved', async () => {
		const service = new CompanyService(new MemoryCompany(), shop(GSTIN));
		const profile = await service.profile();
		expect(profile).toMatchObject({ legalName: 'Shop Legal', tradeName: 'Shop', pan: 'AAPFU0939F' });
	});

	it('saves a profile only with company.edit, and refuses one that misses what its kind needs', async () => {
		const repo = new MemoryCompany();
		const service = new CompanyService(repo, shop(null));
		const write = CompanyProfile.parse({ kind: 'proprietorship' }) as CompanyProfileWrite;
		await expect(service.saveProfile(write, 'u1', false, null)).rejects.toBeInstanceOf(ForbiddenException);
		await expect(service.saveProfile(write, 'u1', true, null)).rejects.toMatchObject({
			response: { message: 'proprietor_needed' },
		});
		const ok = { ...write, proprietor: { name: 'Owner', pan: 'ABCPS1234D', openingCapitalINR: 0 } };
		const saved = await service.saveProfile(ok, 'u1', true, null);
		expect(saved).toMatchObject({ revision: 1, updatedBy: 'u1' });
		expect(repo.profile?.proprietor?.name).toBe('Owner');
	});

	it('adds a GSTIN once, keeps dated terms, and refuses terms that break the scheme rules', async () => {
		const repo = new MemoryCompany();
		const service = new CompanyService(repo, shop(null));
		const added = await service.saveRegistration(
			null,
			{ gstin: GSTIN, legalName: '', tradeName: '', terms, active: true },
			true,
			() => 'gst_1',
		);
		await expect(
			service.saveRegistration(
				null,
				{ gstin: GSTIN, legalName: '', tradeName: '', terms, active: true },
				true,
				() => 'gst_2',
			),
		).rejects.toMatchObject({
			response: { message: 'gstin_already_registered' },
		});
		const later = await service.saveRegistration(
			added.id,
			{
				gstin: GSTIN,
				legalName: '',
				tradeName: '',
				terms: { ...terms, from: '2026-10-01', scheme: 'qrmp' },
				active: true,
			},
			true,
			() => added.id,
		);
		expect(later.terms.map((t) => [t.from, t.scheme])).toEqual([
			['2026-10-01', 'qrmp'],
			['2026-04-01', 'monthly'],
		]);
		await expect(
			service.saveRegistration(
				added.id,
				{
					gstin: GSTIN,
					legalName: '',
					tradeName: '',
					terms: { ...terms, scheme: 'qrmp', lastYearTurnoverINR: 60_000_000 },
					active: true,
				},
				true,
				() => added.id,
			),
		).rejects.toMatchObject({ response: { message: 'qrmp_over_limit' } });
	});

	it('switches features with their needs, and refuses switching off one in use', async () => {
		const repo = new MemoryCompany();
		const service = new CompanyService(repo, shop(null));
		await expect(service.saveFeatures({ stores: true }, 'u1', true, null)).rejects.toMatchObject({
			response: { message: 'feature_needs:stores' },
		});
		await service.saveFeatures({ stores: true, locations: true }, 'u1', true, null);
		expect((await service.features()).rows.find((row) => row.key === 'stores')).toMatchObject({
			on: true,
			needs: ['locations'],
		});
		await expect(
			service.saveFeatures({ locations: false }, 'u1', true, null, { locations: 3 }),
		).rejects.toMatchObject({ response: { message: 'feature_in_use:locations' } });
	});
});
