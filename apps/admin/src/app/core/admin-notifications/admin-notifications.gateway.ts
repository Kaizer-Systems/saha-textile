import type { Observable } from 'rxjs';

export interface NotificationProviderStatus {
	provider: 'console' | 'msg91';
	configured: boolean;
	senderIdConfigured: boolean;
	emailFrom: string;
	emailDomainConfigured: boolean;
	whatsappNumberConfigured: boolean;
}

export interface NotificationChannelSettings {
	id: string;
	channel: 'email' | 'sms' | 'whatsapp';
	category: 'transactional' | 'marketing';
	enabled: boolean;
	planLimit: number | null;
	usedThisPeriod: number;
	warnThresholdPct: number;
	autoDisableAtLimit: boolean;
	periodResetAt: string | null;
	updatedAt?: string;
}

export interface NotificationChannelToggleInput {
	channel: 'email' | 'sms' | 'whatsapp';
	category: 'transactional' | 'marketing';
	enabled?: boolean;
	planLimit?: number | null;
	warnThresholdPct?: number;
	autoDisableAtLimit?: boolean;
}

export interface NotificationTemplate {
	id: string;
	key: string;
	channel: 'email' | 'sms' | 'whatsapp';
	category: 'transactional' | 'marketing';
	name: string;
	description?: string;
	dltHeaderId: string | null;
	dltTemplateId: string | null;
	whatsappTemplateId: string | null;
	status: 'draft' | 'pending_approval' | 'approved' | 'disabled';
}

export interface NotificationTemplateUpsertInput {
	key: string;
	channel: 'email' | 'sms' | 'whatsapp';
	category: 'transactional' | 'marketing';
	name: string;
	description?: string;
	dltHeaderId?: string | null;
	dltTemplateId?: string | null;
	whatsappTemplateId?: string | null;
	status?: 'draft' | 'pending_approval' | 'approved' | 'disabled';
}

/**
 * Admin notification Settings gateway (non-secret surfaces only).
 */
export abstract class AdminNotificationsGateway {
	abstract providerStatus(): Observable<NotificationProviderStatus>;
	abstract listChannels(): Observable<{ items: NotificationChannelSettings[] }>;
	abstract toggleChannel(input: NotificationChannelToggleInput): Observable<NotificationChannelSettings>;
	abstract listTemplates(): Observable<{ items: NotificationTemplate[] }>;
	abstract upsertTemplate(input: NotificationTemplateUpsertInput): Observable<NotificationTemplate>;
}
