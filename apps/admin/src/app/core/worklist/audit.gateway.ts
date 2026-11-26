import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type { AuditLogListResponse } from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const AUDIT_KEYS = {
	list: (query: Record<string, string | number>) => ['audit', 'list', JSON.stringify(query)] as const,
};

/** The audit trail (brief 26 AU1): every admin change, read by module, action, person and time. */
@Injectable({ providedIn: 'root' })
export class AuditGateway {
	private readonly http = inject(HttpClient);

	list(query: Record<string, string | number>): Observable<AuditLogListResponse> {
		return this.http.get<AuditLogListResponse>(`${runtimeConfig.apiUrl}/admin/audit-logs`, { params: query });
	}

	/** Everyone who can appear in the trail, by name (the Who picker). */
	people(): Observable<{ id: string; name: string }[]> {
		return this.http.get<{ id: string; name: string }[]>(`${runtimeConfig.apiUrl}/admin/audit-logs/people`);
	}
}
