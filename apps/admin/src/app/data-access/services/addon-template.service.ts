import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';

export interface AddonTemplateRow {
	code: string;
	label: string;
	priceINR: number;
	unit?: 'in' | 'cm';
	min?: number;
	max?: number;
	step?: number;
}

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
