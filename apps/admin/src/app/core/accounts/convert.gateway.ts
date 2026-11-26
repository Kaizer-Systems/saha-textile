import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import { QUIET } from '../purchasing/purchasing.gateway';

import type { BusinessKind, ConvertPreview, ConvertResult, ConvertWrite } from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

/** Convert to another kind of business (Postings and Convert brief AC1, AC2). */
@Injectable({ providedIn: 'root' })
export class ConvertGateway {
	private readonly http = inject(HttpClient);
	private readonly url = (path = '') => `${runtimeConfig.apiUrl}/admin/company/convert${path}`;

	/** Quiet: the page says what stops it, in place. */
	preview(kind: BusinessKind, lastDay: string): Observable<ConvertPreview> {
		return this.http.get<ConvertPreview>(this.url('/preview'), { ...QUIET, params: { kind, lastDay } });
	}
	convert(write: ConvertWrite): Observable<ConvertResult> {
		return this.http.post<ConvertResult>(this.url(), write, QUIET);
	}
}
