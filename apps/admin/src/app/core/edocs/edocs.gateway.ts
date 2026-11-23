import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import { QUIET } from '../purchasing/purchasing.gateway';

import type {
	AutomaticEDocPath,
	EDocCall,
	EDocKeysWrite,
	EDocSettings,
	EDocSettingsWrite,
	EDocument,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export interface EDocSettingsView {
	gstin: string | null;
	settings: EDocSettings | null;
	keysAvailable: boolean;
}

export const EDOC_KEYS = {
	settings: ['edocs', 'settings'] as const,
	documents: (kind: string) => ['edocs', 'documents', kind] as const,
	activity: ['edocs', 'activity'] as const,
};

/** Settings › E-invoice and e-way bill, its lists and activity (accounts brief addendum 2, AE1–AE9). */
@Injectable({ providedIn: 'root' })
export class EDocsGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path: string) => `${runtimeConfig.apiUrl}/admin/edocs${path}`;

	settings(): Observable<EDocSettingsView> {
		return this.http.get<EDocSettingsView>(this.api('/settings'));
	}
	saveSettings(settings: EDocSettingsWrite, expectedUpdatedAt: string | null): Observable<EDocSettingsView> {
		return this.http.put<EDocSettingsView>(this.api('/settings'), { settings, expectedUpdatedAt }, QUIET);
	}
	saveKeys(keys: EDocKeysWrite): Observable<EDocSettingsView> {
		return this.http.put<EDocSettingsView>(this.api('/keys'), keys, QUIET);
	}
	removeKeys(path: AutomaticEDocPath): Observable<EDocSettingsView> {
		return this.http.delete<EDocSettingsView>(this.api(`/keys/${path}`), QUIET);
	}
	test(path: AutomaticEDocPath): Observable<EDocSettingsView> {
		return this.http.post<EDocSettingsView>(this.api(`/keys/${path}/test`), {}, QUIET);
	}
	documents(query: {
		kind: 'eInvoice' | 'eWayBill';
		status?: string;
		from?: string;
		to?: string;
		q?: string;
		page: number;
	}): Observable<{ rows: EDocument[]; total: number }> {
		const params: Record<string, string> = { kind: query.kind, page: String(query.page) };
		for (const key of ['status', 'from', 'to', 'q'] as const) if (query[key]) params[key] = String(query[key]);
		return this.http.get<{ rows: EDocument[]; total: number }>(this.api('/documents'), { params });
	}
	activity(page: number): Observable<{ rows: EDocCall[]; total: number }> {
		return this.http.get<{ rows: EDocCall[]; total: number }>(this.api('/activity'), {
			params: { page: String(page) },
		});
	}
}
