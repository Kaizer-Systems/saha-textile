import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type { AdminLegalPage, LegalPageWrite } from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export type { AdminLegalPage, LegalPageWrite };

/**
 * Admin › Pages on the API (Legal Pages brief): the four legal pages, read with `page.index` and saved with
 * `page.edit`. A save refused for an empty Title or Content in a shop language answers `legal_page_incomplete`.
 */
@Injectable({ providedIn: 'root' })
export class LegalPagesGateway {
	private readonly http = inject(HttpClient);

	private url(path = ''): string {
		return `${runtimeConfig.apiUrl}/admin/pages${path}`;
	}

	list(): Observable<AdminLegalPage[]> {
		return this.http.get<AdminLegalPage[]>(this.url());
	}

	get(slug: string): Observable<AdminLegalPage> {
		return this.http.get<AdminLegalPage>(this.url(`/${encodeURIComponent(slug)}`));
	}

	save(slug: string, body: LegalPageWrite): Observable<AdminLegalPage> {
		return this.http.patch<AdminLegalPage>(this.url(`/${encodeURIComponent(slug)}`), body);
	}
}
