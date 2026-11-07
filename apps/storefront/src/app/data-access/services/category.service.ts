import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import { backgroundRequest } from '@core/interceptors/background-request';
import { ICategory, ICategoryModel } from '@data-access/interfaces/category.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { IAttachment } from '@data-access/interfaces/attachment.interface';

import { environment } from '../../../../public/environments/environment';

export interface ApiMenuCategory {
	id: string;
	name: string;
	slug: string;
	description: string;
	parentId: string | null;
	level: number;
	path: string;
	imageUrl: string | null;
	iconUrl: string | null;
}

const attachment = (url: string | null): IAttachment | undefined =>
	url ? ({ original_url: url } as IAttachment) : undefined;

const toCategory = (row: ApiMenuCategory): ICategory => ({
	id: row.id,
	name: row.name,
	slug: row.slug,
	description: row.description,
	type: 'product',
	parent_id: row.parentId ?? undefined,
	level: row.level,
	canonical_path: row.path,
	category_image: attachment(row.imageUrl),
	category_icon: attachment(row.iconUrl),
	products_count: 0,
	status: true,
});

@Injectable({
	providedIn: 'root',
})
export class CategoryService {
	private http = inject(HttpClient);

	/** The shop's categories, in the page's language. */
	getCategories(): Observable<ICategoryModel> {
		return this.http
			.get<ApiMenuCategory[]>(`${environment.apiUrl}/catalog/categories/menu`, { context: backgroundRequest() })
			.pipe(map((rows) => ({ data: rows.map(toCategory), total: rows.length }) as ICategoryModel));
	}

	/** Blog categories have no API yet. */
	getBlogCategories(payload?: Params): Observable<ICategoryModel> {
		return this.http.get<ICategoryModel>(`${environment.URL}/category.json`, { params: payload });
	}
}
