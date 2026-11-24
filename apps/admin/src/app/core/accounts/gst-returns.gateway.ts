import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	GstCalendar,
	GstCalendarQuery,
	GstReturnDraft,
	GstReturnPrepareInput,
	GstReturnStep,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const GST_KEYS = {
	all: ['gst-returns'] as const,
	calendar: (query: GstCalendarQuery) => ['gst-returns', 'calendar', query] as const,
	one: (id: string) => ['gst-returns', 'one', id] as const,
};

/** GST returns from the books (accounts brief G3, G4). */
@Injectable({ providedIn: 'root' })
export class GstReturnsGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path = '') => `${runtimeConfig.apiUrl}/admin/accounts/gst/returns${path}`;

	calendar(query: GstCalendarQuery): Observable<GstCalendar> {
		return this.http.get<GstCalendar>(this.api('/calendar'), { params: { ...query } });
	}

	prepare(write: GstReturnPrepareInput): Observable<GstReturnDraft> {
		return this.http.post<GstReturnDraft>(this.api(), write);
	}

	one(id: string): Observable<GstReturnDraft> {
		return this.http.get<GstReturnDraft>(this.api(`/${encodeURIComponent(id)}`));
	}

	step(id: string, write: GstReturnStep): Observable<GstReturnDraft> {
		return this.http.post<GstReturnDraft>(this.api(`/${encodeURIComponent(id)}/step`), write);
	}
}
