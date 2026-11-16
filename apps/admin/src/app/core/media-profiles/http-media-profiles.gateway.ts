import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { QUIET_ERRORS } from '@core/interceptors/global-error-handler.interceptor';

import {
	MediaProfilesGateway,
	type MediaProfile,
	type MediaProfileListItem,
	type MediaProfileRefresh,
	type MediaProfileRefreshStarted,
	type MediaProfileUpdate,
	type MediaProfileWrite,
} from './media-profiles.gateway';

/** Quiet writes: the screens explain a refusal themselves (a toast in the list, the line under the form). */
const quiet = () => ({ context: new HttpContext().set(QUIET_ERRORS, true) });

@Injectable({ providedIn: 'root' })
export class HttpMediaProfilesGateway extends MediaProfilesGateway {
	private readonly http = inject(HttpClient);
	/** Read per call: the runtime config loads after the app starts. */
	private url(path = ''): string {
		return `${runtimeConfig.apiUrl}/admin/media/profiles${path}`;
	}

	override list(): Observable<MediaProfileListItem[]> {
		return this.http.get<MediaProfileListItem[]>(this.url());
	}

	override get(key: string): Observable<MediaProfileListItem> {
		return this.http.get<MediaProfileListItem>(this.url(`/${encodeURIComponent(key)}`));
	}

	override create(write: MediaProfileWrite): Observable<MediaProfile> {
		return this.http.post<MediaProfile>(this.url(), write, quiet());
	}

	override update(key: string, update: MediaProfileUpdate): Observable<MediaProfile> {
		return this.http.put<MediaProfile>(this.url(`/${encodeURIComponent(key)}`), update, quiet());
	}

	override refreshPreview(key: string): Observable<MediaProfileRefresh> {
		return this.http.get<MediaProfileRefresh>(this.url(`/${encodeURIComponent(key)}/refresh`));
	}

	override refresh(key: string): Observable<MediaProfileRefreshStarted> {
		return this.http.post<MediaProfileRefreshStarted>(this.url(`/${encodeURIComponent(key)}/refresh`), {}, quiet());
	}

	override remove(key: string): Observable<void> {
		return this.http.delete<void>(this.url(`/${encodeURIComponent(key)}`), quiet());
	}
}
