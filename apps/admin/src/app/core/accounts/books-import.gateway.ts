import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	BooksExportFile,
	BooksExportQuery,
	BooksImport,
	ImportBringInValue,
	ImportInputValue,
	ImportPreview,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const BOOKS_IMPORT_KEYS = { list: ['accounts', 'imports'] as const };

/** Bringing books in and taking them out (accounts brief I1, W1–W4). */
@Injectable({ providedIn: 'root' })
export class BooksImportGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path: string) => `${runtimeConfig.apiUrl}/admin/accounts/${path}`;

	list(): Observable<BooksImport[]> {
		return this.http.get<BooksImport[]>(this.api('import'));
	}

	check(input: ImportInputValue): Observable<ImportPreview> {
		return this.http.post<ImportPreview>(this.api('import/check'), input);
	}

	bringIn(input: ImportBringInValue): Observable<BooksImport> {
		return this.http.post<BooksImport>(this.api('import'), input);
	}

	undo(id: string): Observable<BooksImport> {
		return this.http.post<BooksImport>(this.api(`import/${encodeURIComponent(id)}/undo`), {});
	}

	export(query: BooksExportQuery): Observable<BooksExportFile> {
		const params: Record<string, string> = { format: query.format, from: query.from, to: query.to };
		if (query.locationId) params['locationId'] = query.locationId;
		return this.http.get<BooksExportFile>(this.api('export'), { params });
	}
}
