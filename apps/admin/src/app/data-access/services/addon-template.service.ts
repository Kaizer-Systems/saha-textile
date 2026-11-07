import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import type { AddonTemplateWrite } from '@saha-textile/contracts';
import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';

export type AddonTemplateRow = AddonTemplateWrite;

@Injectable({ providedIn: 'root' })
export class AddonTemplateService {
	private http = inject(HttpClient);

	list(): Observable<AddonTemplateRow[]> {
		return this.http.get<AddonTemplateRow[]>(`${environment.apiUrl}/admin/catalog/addon-templates`);
	}

	save(row: AddonTemplateRow): Observable<AddonTemplateRow> {
		return this.http.post<AddonTemplateRow>(`${environment.apiUrl}/admin/catalog/addon-templates`, row);
	}

	remove(code: string): Observable<void> {
		return this.http.delete<void>(
			`${environment.apiUrl}/admin/catalog/addon-templates/${encodeURIComponent(code)}`,
		);
	}
}
