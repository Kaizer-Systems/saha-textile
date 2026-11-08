import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import { ICategory, ICategoryModel } from '@data-access/interfaces/category.interface';
import { Params } from '@data-access/interfaces/core.interface';

import { environment } from '../../../../public/environments/environment';

import type { AdminCategoryRow, AdminCategoryWrite, BlogCategory } from '@saha-textile/contracts';

/** A row as the tree and dropdowns draw it, with every language kept for the form. */
function toCategory(row: AdminCategoryRow): ICategory {
	return {
		id: row.id,
		name: row.name['en'] ?? row.slug,
		slug: row.slug,
		description: row.description['en'] ?? '',
		type: 'product',
		parent_id: row.parentId ?? undefined,
		status: true,
		row,
	};
}

/** A blog category as the tree and the post form's dropdown draw it. Blog categories are flat. */
export function toBlogCategory(row: BlogCategory): ICategory {
	return {
		id: row.id,
		name: row.name['en'] ?? row.slug,
		slug: row.slug,
		description: row.description['en'] ?? '',
		type: 'post',
		status: row.status === 'live',
		blog: row,
	};
}

function nest(rows: readonly AdminCategoryRow[]): ICategory[] {
	const all = rows.map(toCategory);
	const byId = new Map(all.map((category) => [category.id, category]));
	const top: ICategory[] = [];
	for (const category of all) {
		const parent = category.parent_id ? byId.get(category.parent_id) : undefined;
		if (parent) (parent.subcategories ??= []).push(category);
		else top.push(category);
	}
	return top;
}

@Injectable({
	providedIn: 'root',
})
export class CategoryService {
	private http = inject(HttpClient);
	private base = () => `${environment.apiUrl}/admin/catalog/categories`;

	getCategories(payload?: Params): Observable<ICategoryModel> {
		if (payload?.['type'] === 'post') {
			return this.http
				.get<BlogCategory[]>(`${environment.apiUrl}/admin/blog/categories`)
				.pipe(map((rows) => ({ data: rows.map(toBlogCategory), total: rows.length }) as ICategoryModel));
		}
		return this.http
			.get<AdminCategoryRow[]>(this.base())
			.pipe(map((rows) => ({ data: nest(rows), total: rows.length }) as ICategoryModel));
	}

	getCategoryRows(): Observable<AdminCategoryRow[]> {
		return this.http.get<AdminCategoryRow[]>(this.base());
	}

	saveCategory(id: string | null, body: AdminCategoryWrite): Observable<{ id: string }> {
		return this.http.post<{ id: string }>(id ? `${this.base()}/${encodeURIComponent(id)}` : this.base(), body);
	}

	deleteCategory(id: string): Observable<void> {
		return this.http.delete<void>(`${this.base()}/${encodeURIComponent(id)}`);
	}
}
