import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { ITag, ITagModel } from '@data-access/interfaces/tag.interface';

import { environment } from '../../../../public/environments/environment';

import type { BlogTag } from '@saha-textile/contracts';

/** A blog tag as the tag table and the post form's dropdown draw it. */
export function toBlogTag(row: BlogTag): ITag {
	return {
		id: row.id,
		name: row.name['en'] ?? row.slug,
		slug: row.slug,
		description: row.description['en'] ?? '',
		type: 'post',
		status: row.status === 'live',
		created_by_id: 0,
		created_at: row.createdAt,
		blog: row,
	};
}

@Injectable({
	providedIn: 'root',
})
export class TagService {
	private http = inject(HttpClient);

	/** Blog tags come from the API; the product tag screens still read the theme's list. */
	getTags(payload?: Params): Observable<ITagModel> {
		if (payload?.['type'] === 'post') {
			return this.http
				.get<BlogTag[]>(`${environment.apiUrl}/admin/blog/tags`)
				.pipe(map((rows) => ({ data: rows.map(toBlogTag), total: rows.length }) as ITagModel));
		}
		return this.http.get<ITagModel>(`${environment.URL}/tag.json`, { params: payload });
	}
}
