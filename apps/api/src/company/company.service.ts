import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
	CompanyProfile,
	type CompanyProfileWrite,
	FEATURE_KEYS,
	type FeatureKey,
	type FeatureRow,
	FeatureSwitches,
	type GstRegistration,
	type GstRegistrationWrite,
	type ShopDetails,
} from '@saha-textile/contracts';
import {
	type CompanyRepository,
	FEATURE_NEEDS,
	type ShopDetailsRepository,
	companyProblems,
	switchRefusals,
	termsProblems,
} from '@saha-textile/core-domain';

import { COMPANY_REPOSITORY, SHOP_DETAILS_REPOSITORY } from '../infra/tokens';

const refuse = (codes: readonly string[]) =>
	new BadRequestException({
		message: codes[0] ?? 'refused',
		issues: codes.map((code) => ({ path: [code], message: code, code })),
	});

/**
 * Settings › Company, Registrations and Features (accounts brief J, CT, G1–G2; owner-approved
 * 2026-11-23). Reading needs Settings access; saving needs company.edit. Until a profile is saved,
 * the page starts from Shop details (legal and trade name, GSTIN), so nothing is typed twice.
 */
@Injectable()
export class CompanyService {
	constructor(
		@Inject(COMPANY_REPOSITORY) private readonly repository: CompanyRepository,
		@Inject(SHOP_DETAILS_REPOSITORY) private readonly shop: ShopDetailsRepository,
	) {}

	async profile(): Promise<CompanyProfile> {
		const saved = await this.repository.getProfile();
		if (saved) return saved;
		const shop: ShopDetails | null = await this.shop.get();
		return CompanyProfile.parse({
			legalName: shop?.legalName ?? '',
			tradeName: shop?.tradeName ?? '',
			pan: shop?.gstin ? shop.gstin.slice(2, 12) : null,
		});
	}

	async saveProfile(
		write: CompanyProfileWrite,
		actorId: string | null,
		canEdit: boolean,
		expectedUpdatedAt: string | null,
	): Promise<CompanyProfile> {
		if (!canEdit) throw new ForbiddenException('company_edit_needed');
		const next = CompanyProfile.parse({
			...write,
			revision: write.revision + 1,
			updatedAt: new Date().toISOString(),
			updatedBy: actorId,
		});
		const problems = companyProblems(next);
		if (problems.length) throw refuse(problems);
		await this.repository.saveProfile(next, expectedUpdatedAt);
		return next;
	}

	registrations(): Promise<GstRegistration[]> {
		return this.repository.listRegistrations();
	}

	async saveRegistration(
		id: string | null,
		write: GstRegistrationWrite,
		canEdit: boolean,
		newId: () => string,
	): Promise<GstRegistration> {
		if (!canEdit) throw new ForbiddenException('company_edit_needed');
		const stateCode = write.gstin.slice(0, 2);
		const problems = termsProblems(write.terms, stateCode);
		if (problems.length) throw refuse(problems);
		const now = new Date().toISOString();
		const existing = id
			? await this.repository.getRegistration(id)
			: await this.repository.findRegistrationByGstin(write.gstin);
		if (id && !existing) throw new NotFoundException('gst_registration_not_found');
		if (!id && existing) throw refuse(['gstin_already_registered']);
		const terms = existing
			? [write.terms, ...existing.terms.filter((terms) => terms.from !== write.terms.from)]
			: [write.terms];
		const next: GstRegistration = {
			id: existing?.id ?? newId(),
			gstin: write.gstin,
			stateCode,
			legalName: write.legalName,
			tradeName: write.tradeName,
			terms: terms.sort((a, b) => (a.from < b.from ? 1 : -1)),
			active: write.active,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		await this.repository.saveRegistration(next, existing?.updatedAt ?? null);
		return next;
	}

	/** Each switch with how many records use it; counts come from the areas as they are built. */
	async features(
		inUse: Partial<Record<FeatureKey, number>> = {},
	): Promise<{ rows: FeatureRow[]; updatedAt: string | null }> {
		const saved = (await this.repository.getFeatures()) ?? FeatureSwitches.parse({});
		return {
			rows: FEATURE_KEYS.map((key) => ({
				key,
				on: saved.on[key] ?? false,
				inUse: inUse[key] ?? 0,
				needs: [...(FEATURE_NEEDS[key] ?? [])],
			})),
			updatedAt: saved.updatedAt,
		};
	}

	async saveFeatures(
		next: Partial<Record<FeatureKey, boolean>>,
		actorId: string | null,
		canEdit: boolean,
		expectedUpdatedAt: string | null,
		inUse: Partial<Record<FeatureKey, number>> = {},
	): Promise<FeatureSwitches> {
		if (!canEdit) throw new ForbiddenException('company_edit_needed');
		const saved = (await this.repository.getFeatures()) ?? FeatureSwitches.parse({});
		const refusals = switchRefusals(next, saved.on, inUse);
		if (refusals.length) throw refuse(refusals.map((refusal) => `feature_${refusal.reason}:${refusal.key}`));
		const features = FeatureSwitches.parse({
			on: { ...saved.on, ...next },
			revision: saved.revision + 1,
			updatedAt: new Date().toISOString(),
			updatedBy: actorId,
		});
		await this.repository.saveFeatures(features, expectedUpdatedAt);
		return features;
	}
}
