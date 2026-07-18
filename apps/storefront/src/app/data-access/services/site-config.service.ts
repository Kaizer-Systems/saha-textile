import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

import { Observable } from 'rxjs';

import { ISiteConfigResponse } from '@data-access/interfaces/site-config.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class SiteConfigService {
	private http = inject(HttpClient);

	// A signal (not a plain field): the full-page loader is toggled from component
	// effects that run during change detection, and the Layout template reads it via
	// `@if`. A plain field mutated mid-CD triggers NG0100 (ExpressionChangedAfter
	// Checked); a signal write schedules a glitch-free re-render instead.
	public readonly preloader = signal(true);
	public theme_color: string;

	getSiteConfig(): Observable<ISiteConfigResponse> {
		return this.http.get<ISiteConfigResponse>(`${environment.URL}/site-config.json`);
	}
}
