import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { EDOC_KEYS, EDocsGateway } from '@core/edocs/edocs.gateway';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

/**
 * Settings › E-invoice and e-way bill › Activity (accounts brief addendum 2, EI14): every call and every by-hand
 * entry with its result, newest first. Keys, passwords and payloads are never written here.
 */
@Component({
	selector: 'app-edoc-activity',
	imports: [PageWrapper, TranslocoModule, DatePipe],
	templateUrl: './edoc-activity.html',
})
export class EDocActivityPage {
	private readonly gateway = inject(EDocsGateway);
	readonly page = signal(1);
	readonly query = injectQuery(() => ({
		queryKey: [...EDOC_KEYS.activity, this.page()],
		queryFn: () => firstValueFrom(this.gateway.activity(this.page())),
	}));
	readonly rows = computed(() => this.query.data()?.rows ?? []);
	/** The newest automatic call failed with no answer: the by-hand popup is taking over (AE7). */
	readonly down = computed(() => {
		const latest = this.rows().find((r) => r.path !== 'manual');
		return latest && !latest.ok && latest.code === 'unavailable' ? latest : null;
	});
	readonly pages = computed(() => Math.max(1, Math.ceil((this.query.data()?.total ?? 0) / 50)));
}
