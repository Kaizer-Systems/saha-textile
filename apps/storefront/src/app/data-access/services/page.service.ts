import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { catchError, Observable, map } from 'rxjs';

import { IFaqModel } from '@data-access/interfaces/page.interface';
import { IStaticPage } from '@data-access/interfaces/static-page.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class PageService {
	private http = inject(HttpClient);

	public skeletonLoader: boolean = false;

	/** The shop-wide FAQ in the page language (English where a translation is missing). */
	getFaqs(locale = 'en'): Observable<IFaqModel> {
		const pick = (text: Record<string, string | undefined>) => text[locale] || text['en'] || '';
		return this.http
			.get<Array<{ id: string; question: Record<string, string>; answer: Record<string, string> }>>(
				`${environment.apiUrl}/catalog/faq`,
			)
			.pipe(
				map((rows) => ({
					data: rows.map((row, index) => ({
						id: index + 1,
						title: pick(row.question),
						description: pick(row.answer),
						created_by_id: '',
						status: 'live',
					})),
					total: rows.length,
				})),
			);
	}

	// Static content pages (privacy policy, terms, etc.) — one JSON per slug
	// under assets/data/pages/.
	getPage(slug: string, locale = 'en'): Observable<IStaticPage> {
		const english = this.http.get<IStaticPage>(`${environment.URL}/pages/${slug}.json`);
		if (locale === 'en') return english;
		return this.http
			.get<IStaticPage>(`${environment.URL}/pages/${slug}.${locale}.json`)
			.pipe(catchError(() => english));
	}
}
