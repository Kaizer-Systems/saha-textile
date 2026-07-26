import { signal } from '@angular/core';

interface StorybookNotification {
	id: string;
	read_at?: string;
	data: { title: string; message: string; type: string };
}

interface StorybookNotificationPage {
	data: StorybookNotification[];
	total: number;
}

export function injectNotificationsQuery() {
	return {
		data: signal<StorybookNotificationPage | undefined>({ data: [], total: 0 }),
	};
}
