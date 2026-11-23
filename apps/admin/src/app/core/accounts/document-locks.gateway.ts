import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type { DocumentLock } from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

/** Who edits a document (accounts brief D10, B7): take it, keep it, let it go, ask for it, or take it over. */
@Injectable({ providedIn: 'root' })
export class DocumentLocksGateway {
	private readonly http = inject(HttpClient);
	private readonly url = (rest = '') => `${runtimeConfig.apiUrl}/admin/document-locks${rest}`;

	claim(documentType: string, documentId: string): Observable<DocumentLock> {
		return this.http.post<DocumentLock>(this.url(), { documentType, documentId });
	}
	heartbeat(documentType: string, documentId: string): Observable<{ held: boolean }> {
		return this.http.post<{ held: boolean }>(this.url('/heartbeat'), { documentType, documentId });
	}
	current(documentType: string, documentId: string): Observable<{ lock: DocumentLock | null; role: string | null }> {
		return this.http.get<{ lock: DocumentLock | null; role: string | null }>(
			this.url(`/${encodeURIComponent(documentType)}/${encodeURIComponent(documentId)}`),
		);
	}
	askRelease(documentType: string, documentId: string): Observable<{ asked: boolean }> {
		return this.http.post<{ asked: boolean }>(this.url('/ask-release'), { documentType, documentId });
	}
	takeOver(documentType: string, documentId: string): Observable<DocumentLock> {
		return this.http.post<DocumentLock>(this.url('/take-over'), { documentType, documentId });
	}
	release(documentType: string, documentId: string): Observable<void> {
		return this.http.delete<void>(
			this.url(`/${encodeURIComponent(documentType)}/${encodeURIComponent(documentId)}`),
		);
	}
}
