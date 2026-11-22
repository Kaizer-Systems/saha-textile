import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { QUIET_ERRORS } from '@core/interceptors/global-error-handler.interceptor';

import { environment } from '../../../../public/environments/environment';

import type {
	DocumentFormat,
	DocumentFormatCreate,
	DocumentFormatPreview,
	DocumentFormatsView,
	DocumentFormatSwitchResult,
	DocumentFormatWrite,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

const base = `${environment.apiUrl}/admin/document-formats`;
const id = (value: string) => encodeURIComponent(value);
/** These screens say what went wrong themselves (F03's note, the builder's notes), so the global toast stays quiet. */
const quiet = () => new HttpContext().set(QUIET_ERRORS, true);

/** Settings › Document formats and the format builder (bundle builder brief F01–F05, approved 2026-11-22). */
@Injectable({ providedIn: 'root' })
export class DocumentFormatService {
	private readonly http = inject(HttpClient);

	list(): Observable<DocumentFormatsView> {
		return this.http.get<DocumentFormatsView>(base);
	}

	one(formatId: string): Observable<DocumentFormat> {
		return this.http.get<DocumentFormat>(`${base}/${id(formatId)}`);
	}

	create(body: DocumentFormatCreate): Observable<DocumentFormat> {
		return this.http.post<DocumentFormat>(base, body);
	}

	save(formatId: string, body: DocumentFormatWrite): Observable<DocumentFormat> {
		return this.http.put<DocumentFormat>(`${base}/${id(formatId)}`, body, { context: quiet() });
	}

	duplicate(formatId: string): Observable<DocumentFormat> {
		return this.http.post<DocumentFormat>(`${base}/${id(formatId)}/duplicate`, {});
	}

	switchOn(formatId: string): Observable<DocumentFormatSwitchResult> {
		return this.http.post<DocumentFormatSwitchResult>(`${base}/${id(formatId)}/switch-on`, {});
	}

	/** Always refused by the server with the reason (F03); the page shows it. */
	switchOff(formatId: string): Observable<never> {
		return this.http.post<never>(`${base}/${id(formatId)}/switch-off`, {}, { context: quiet() });
	}

	/** The live preview: the document's example drawn with these blocks, as HTML. */
	preview(formatId: string, body: DocumentFormatPreview): Observable<string> {
		return this.http.post(`${base}/${id(formatId)}/preview`, body, { responseType: 'text', context: quiet() });
	}

	/** The saved format's example as a PDF (eye and download buttons). */
	pdf(formatId: string): Observable<Blob> {
		return this.http.get(`${base}/${id(formatId)}/pdf`, { responseType: 'blob' });
	}

	/** Preview PDF in the builder: unsaved blocks. */
	draftPdf(formatId: string, body: DocumentFormatPreview): Observable<Blob> {
		return this.http.post(`${base}/${id(formatId)}/pdf`, body, { responseType: 'blob' });
	}
}
