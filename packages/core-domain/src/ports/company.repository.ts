import type { CompanyProfile, FeatureSwitches, GstRegistration } from '@saha-textile/contracts';

/**
 * Company setup (accounts brief J, CT, G1–G2; owner-approved 2026-11-23). One profile and one set of
 * feature switches per deployment; GST registrations are one per state (plus an ISD when used).
 * Saves are refused with StaleVersionError when someone else saved since the editor read.
 */
export interface CompanyRepository {
	getProfile(): Promise<CompanyProfile | null>;
	saveProfile(profile: CompanyProfile, expectedUpdatedAt: string | null): Promise<void>;
	listRegistrations(): Promise<GstRegistration[]>;
	getRegistration(id: string): Promise<GstRegistration | null>;
	findRegistrationByGstin(gstin: string): Promise<GstRegistration | null>;
	saveRegistration(registration: GstRegistration, expectedUpdatedAt: string | null): Promise<void>;
	getFeatures(): Promise<FeatureSwitches | null>;
	saveFeatures(features: FeatureSwitches, expectedUpdatedAt: string | null): Promise<void>;
}
