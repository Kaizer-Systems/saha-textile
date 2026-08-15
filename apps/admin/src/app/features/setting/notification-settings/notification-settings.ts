import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { injectMutation, injectQueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import {
	AdminNotificationsGateway,
	type NotificationChannelSettings,
	type NotificationTemplate,
} from '@core/admin-notifications/admin-notifications.gateway';
import {
	injectNotificationChannelsQuery,
	injectNotificationProviderQuery,
	injectNotificationTemplatesQuery,
} from '@data-access/queries/admin-notifications.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';

/**
 * Non-secret notification Settings (DEC-UI-REUSE: PageWrapper + FormFields + Bootstrap switches).
 *
 * Authkey is never shown or collected — API env only.
 */
@Component({
	selector: 'app-notification-settings',
	templateUrl: './notification-settings.html',
	imports: [PageWrapper, ReactiveFormsModule, FormFields, Button, HasPermissionDirective, TranslocoModule],
})
export class NotificationSettings {
	private readonly gateway = inject(AdminNotificationsGateway);
	private readonly queryClient = injectQueryClient();
	private readonly formBuilder = inject(FormBuilder);

	readonly providerQuery = injectNotificationProviderQuery();
	readonly channelsQuery = injectNotificationChannelsQuery();
	readonly templatesQuery = injectNotificationTemplatesQuery();

	readonly provider = computed(() => this.providerQuery.data());
	readonly channels = computed(() => this.channelsQuery.data()?.items ?? []);
	readonly templates = computed(() => this.templatesQuery.data()?.items ?? []);

	readonly editingKey = signal<string | null>(null);

	readonly templateForm = this.formBuilder.nonNullable.group({
		key: ['', Validators.required],
		name: ['', Validators.required],
		channel: this.formBuilder.nonNullable.control<'email' | 'sms' | 'whatsapp'>('email'),
		category: this.formBuilder.nonNullable.control<'transactional' | 'marketing'>('transactional'),
		status: this.formBuilder.nonNullable.control<'draft' | 'pending_approval' | 'approved' | 'disabled'>('draft'),
		dltHeaderId: [''],
		dltTemplateId: [''],
		whatsappTemplateId: [''],
	});

	private readonly toggleMutation = injectMutation(() => ({
		mutationFn: (input: {
			channel: NotificationChannelSettings['channel'];
			category: NotificationChannelSettings['category'];
			enabled: boolean;
		}) => lastValueFrom(this.gateway.toggleChannel(input)),
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-notifications', 'channels'] });
		},
	}));

	private readonly upsertMutation = injectMutation(() => ({
		mutationFn: () => {
			const value = this.templateForm.getRawValue();
			return lastValueFrom(
				this.gateway.upsertTemplate({
					key: value.key,
					name: value.name,
					channel: value.channel,
					category: value.category,
					status: value.status,
					dltHeaderId: value.dltHeaderId || null,
					dltTemplateId: value.dltTemplateId || null,
					whatsappTemplateId: value.whatsappTemplateId || null,
				}),
			);
		},
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-notifications', 'templates'] });
			this.editingKey.set(null);
			this.templateForm.reset({
				key: '',
				name: '',
				channel: 'email',
				category: 'transactional',
				status: 'draft',
				dltHeaderId: '',
				dltTemplateId: '',
				whatsappTemplateId: '',
			});
		},
	}));

	toggleEnabled(row: NotificationChannelSettings, enabled: boolean): void {
		this.toggleMutation.mutate({
			channel: row.channel,
			category: row.category,
			enabled,
		});
	}

	onEnabledChange(row: NotificationChannelSettings, event: Event): void {
		const target = event.target;
		if (!(target instanceof HTMLInputElement)) return;
		this.toggleEnabled(row, target.checked);
	}

	editTemplate(template: NotificationTemplate): void {
		this.editingKey.set(template.key);
		this.templateForm.setValue({
			key: template.key,
			name: template.name,
			channel: template.channel,
			category: template.category,
			status: template.status,
			dltHeaderId: template.dltHeaderId ?? '',
			dltTemplateId: template.dltTemplateId ?? '',
			whatsappTemplateId: template.whatsappTemplateId ?? '',
		});
	}

	submitTemplate(): void {
		if (this.templateForm.invalid) {
			this.templateForm.markAllAsTouched();
			return;
		}
		this.upsertMutation.mutate();
	}
}
