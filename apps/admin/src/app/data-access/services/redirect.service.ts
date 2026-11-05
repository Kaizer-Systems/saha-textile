import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';

export interface RedirectRow {
	id: string;
	sourcePath: string;
	statusCode: 301 | 302 | 410;
	targetPath?: string;
	reason: string;
	entityType?: string;
}

@Injectable({ providedIn: 'root' })
export class RedirectService {
	private http = inject(HttpClient);

	list(): Observable<RedirectRow[]> {
		return this.http.get<RedirectRow[]>(`${environment.apiUrl}/admin/catalog/redirects`);
	}

	save(row: Omit<RedirectRow, 'id'>): Observable<RedirectRow> {
		return this.http.post<RedirectRow>(`${environment.apiUrl}/admin/catalog/redirects`, row);
	}

	remove(sourcePath: string): Observable<void> {
		return this.http.delete<void>(`${environment.apiUrl}/admin/catalog/redirects`, { params: { sourcePath } });
	}
}
