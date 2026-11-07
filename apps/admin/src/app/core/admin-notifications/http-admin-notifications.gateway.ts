import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';

import {
	AdminNotificationsGateway,
	type NotificationChannelSettings,
	type NotificationChannelToggleInput,
	type NotificationProviderStatus,
	type NotificationTemplate,
	type NotificationTemplateUpsertInput,
} from './admin-notifications.gateway';

@Injectable({ providedIn: 'root' })
export class HttpAdminNotificationsGateway extends AdminNotificationsGateway {
	private readonly http = inject(HttpClient);

	private url(path: string): string {
		return `${runtimeConfig.apiUrl}${path}`;
	}

	override providerStatus(): Observable<NotificationProviderStatus> {
		return this.http.get<NotificationProviderStatus>(this.url('/admin/notifications/provider'));
	}

	override listChannels(): Observable<{ items: NotificationChannelSettings[] }> {
		return this.http.get<{ items: NotificationChannelSettings[] }>(this.url('/admin/notifications/channels'));
	}

	override toggleChannel(input: NotificationChannelToggleInput): Observable<NotificationChannelSettings> {
		return this.http.patch<NotificationChannelSettings>(this.url('/admin/notifications/channels'), input);
	}

	override listTemplates(): Observable<{ items: NotificationTemplate[] }> {
		return this.http.get<{ items: NotificationTemplate[] }>(this.url('/admin/notifications/templates'));
	}

	override upsertTemplate(input: NotificationTemplateUpsertInput): Observable<NotificationTemplate> {
		return this.http.put<NotificationTemplate>(this.url('/admin/notifications/templates'), input);
	}
}
