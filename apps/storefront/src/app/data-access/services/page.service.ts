import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import { IFaqModel } from '@data-access/interfaces/page.interface';
import { IStaticPage } from '@data-access/interfaces/static-page.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class PageService {
	private http = inject(HttpClient);

	public skeletonLoader: boolean = false;

	getFaqs(): Observable<IFaqModel> {
		return this.http
			.get<Array<{ id: string; question: { en: string }; answer: { en: string } }>>(
				`${environment.apiUrl}/catalog/faq`,
			)
			.pipe(
				map((rows) => ({
					data: rows.map((row, index) => ({
						id: index + 1,
						title: row.question.en,
						description: row.answer.en,
						created_by_id: '',
						status: 'live',
					})),
					total: rows.length,
				})),
			);
	}

	// Static content pages (privacy policy, terms, etc.) — one JSON per slug
	// under assets/data/pages/.
	getPage(slug: string): Observable<IStaticPage> {
		return this.http.get<IStaticPage>(`${environment.URL}/pages/${slug}.json`);
	}
}
