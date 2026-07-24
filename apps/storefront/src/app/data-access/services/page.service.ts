import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

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
		return this.http.get<IFaqModel>(`${environment.URL}/faq.json`);
	}

	// Static content pages (privacy policy, terms, etc.) — one JSON per slug
	// under assets/data/pages/.
	getPage(slug: string): Observable<IStaticPage> {
		return this.http.get<IStaticPage>(`${environment.URL}/pages/${slug}.json`);
	}
}
