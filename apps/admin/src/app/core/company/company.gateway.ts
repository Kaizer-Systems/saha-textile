import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import { QUIET } from '../purchasing/purchasing.gateway';

import type {
	CompanyProfile,
	CompanyProfileWrite,
	FeatureKey,
	FeatureRow,
	FeatureSwitches,
	GstRegistration,
	GstRegistrationWrite,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

/** Query keys: a save refreshes every screen that shows what it changed. */
export const COMPANY_KEYS = {
	profile: ['company', 'profile'] as const,
	registrations: ['company', 'registrations'] as const,
	features: ['company', 'features'] as const,
};

/**
 * Settings › Company, Registrations and Features (accounts brief J, CT, G1–G2; owner-approved
 * 2026-11-23). Reading needs Settings access; the API refuses saves without company.edit.
 */
@Injectable({ providedIn: 'root' })
export class CompanyGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path: string) => `${runtimeConfig.apiUrl}/admin/company${path}`;

	profile(): Observable<CompanyProfile> {
		return this.http.get<CompanyProfile>(this.api(''));
	}
	saveProfile(profile: CompanyProfileWrite, expectedUpdatedAt: string | null): Observable<CompanyProfile> {
		return this.http.put<CompanyProfile>(this.api(''), { profile, expectedUpdatedAt }, QUIET);
	}
	registrations(): Observable<GstRegistration[]> {
		return this.http.get<GstRegistration[]>(this.api('/registrations'));
	}
	addRegistration(body: GstRegistrationWrite): Observable<GstRegistration> {
		return this.http.post<GstRegistration>(this.api('/registrations'), body, QUIET);
	}
	saveRegistration(id: string, body: GstRegistrationWrite): Observable<GstRegistration> {
		return this.http.put<GstRegistration>(this.api(`/registrations/${encodeURIComponent(id)}`), body, QUIET);
	}
	features(): Observable<{ rows: FeatureRow[]; updatedAt: string | null }> {
		return this.http.get<{ rows: FeatureRow[]; updatedAt: string | null }>(this.api('/features'));
	}
	saveFeatures(
		on: Partial<Record<FeatureKey, boolean>>,
		expectedUpdatedAt: string | null,
	): Observable<FeatureSwitches> {
		return this.http.put<FeatureSwitches>(this.api('/features'), { on, expectedUpdatedAt }, QUIET);
	}
}
