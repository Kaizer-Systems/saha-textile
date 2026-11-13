import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { QUIET_ERRORS } from '@core/interceptors/global-error-handler.interceptor';

import {
	AdminCommunicationsGateway,
	type CommunicationSettingsResponse,
	type CommunicationSwitchWrite,
} from './admin-communications.gateway';

@Injectable({ providedIn: 'root' })
export class HttpAdminCommunicationsGateway extends AdminCommunicationsGateway {
	private readonly http = inject(HttpClient);
	/** Read per call: the runtime config loads after the app starts. */
	private url(): string {
		return `${runtimeConfig.apiUrl}/admin/communications`;
	}

	override settings(): Observable<CommunicationSettingsResponse> {
		return this.http.get<CommunicationSettingsResponse>(this.url());
	}

	/** Quiet: the page explains a refusal itself, in the password popup or beside the table. */
	override change(input: CommunicationSwitchWrite): Observable<CommunicationSettingsResponse> {
		return this.http.put<CommunicationSettingsResponse>(this.url(), input, {
			context: new HttpContext().set(QUIET_ERRORS, true),
		});
	}
}
