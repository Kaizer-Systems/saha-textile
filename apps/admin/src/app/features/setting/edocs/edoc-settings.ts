import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { EDOC_KEYS, EDocsGateway, type EDocSettingsView } from '@core/edocs/edocs.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type {
	AutomaticEDocPath,
	EDocEnvironment,
	EDocProvider,
	EInvoicePath,
	EWayBillPath,
} from '@saha-textile/contracts';

/** The five paths as the keys table lists them (EI2). */
export const EDOC_PATH_ROWS: readonly {
	id: 'manualInvoice' | 'manualBill' | AutomaticEDocPath;
	kind: 'eInvoice' | 'eWayBill';
	automatic: boolean;
	paid: boolean;
}[] = [
	{ id: 'manualInvoice', kind: 'eInvoice', automatic: false, paid: false },
	{ id: 'irpDirect', kind: 'eInvoice', automatic: true, paid: false },
	{ id: 'irpProvider', kind: 'eInvoice', automatic: true, paid: true },
	{ id: 'manualBill', kind: 'eWayBill', automatic: false, paid: false },
	{ id: 'ewbDirect', kind: 'eWayBill', automatic: true, paid: false },
	{ id: 'ewbProvider', kind: 'eWayBill', automatic: true, paid: true },
];

/** Providers each automatic path can use (AE2, AE3). */
export const PATH_PROVIDERS: Record<AutomaticEDocPath, EDocProvider[]> = {
	irpDirect: ['irisIrp', 'nicIrp'],
	irpProvider: ['mastersIndia'],
	ewbDirect: ['nicEwb'],
	ewbProvider: ['mastersIndia'],
};

/** Sandbox addresses read from the providers' own pages (23 Nov 2026); production addresses come with their keys. */
const SANDBOX_URL: Partial<Record<EDocProvider, string>> = {
	irisIrp: 'https://sandbox.einvoice6.gst.gov.in',
	nicIrp: 'https://einv-apisandbox.nic.in',
	mastersIndia: 'https://clientbasic.mastersindia.co',
};

/**
 * Settings › E-invoice and e-way bill (accounts brief addendum 2, EI1 and EI2; owner-approved 2026-11-23, AE1–AE9).
 * The path per document for this business's GSTIN, the enabled-from date and the e-way bill threshold, and the
 * keys of the four automatic paths. An automatic path can be chosen only after its keys pass Test.
 */
@Component({
	selector: 'app-edoc-settings',
	imports: [PageWrapper, TranslocoModule, FormsModule, RouterLink],
	templateUrl: './edoc-settings.html',
})
export class EDocSettingsPage {
	private readonly gateway = inject(EDocsGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);

	readonly rows = EDOC_PATH_ROWS;
	readonly canEdit = computed(() => this.auth.permissions().includes('edocs.settings'));
	readonly query = injectQuery(() => ({
		queryKey: EDOC_KEYS.settings,
		queryFn: () => firstValueFrom(this.gateway.settings()),
	}));
	readonly settings = computed(() => this.query.data()?.settings ?? null);

	readonly eInvoicePath = signal<EInvoicePath>('manual');
	readonly eWayBillPath = signal<EWayBillPath>('manual');
	readonly withEInvoice = signal(true);
	readonly enabledFrom = signal('');
	readonly threshold = signal(50_000);
	readonly saving = signal(false);

	/** The keys form (EI2): open for one automatic path at a time. */
	readonly keysPath = signal<AutomaticEDocPath | null>(null);
	readonly provider = signal<EDocProvider>('irisIrp');
	readonly environment = signal<EDocEnvironment>('sandbox');
	readonly baseUrl = signal('');
	readonly userName = signal('');
	readonly password = signal('');
	readonly clientId = signal('');
	readonly clientSecret = signal('');
	readonly publicKeyPem = signal('');

	constructor() {
		effect(() => {
			const s = this.settings();
			if (!s) return;
			untracked(() => {
				this.eInvoicePath.set(s.eInvoicePath);
				this.eWayBillPath.set(s.eWayBillPath);
				this.withEInvoice.set(s.eWayBillWithEInvoice);
				this.enabledFrom.set(s.eInvoiceEnabledFrom ?? '');
				this.threshold.set(s.eWayBillThresholdINR);
			});
		});
	}

	keysOf(path: AutomaticEDocPath) {
		return this.settings()?.keys.find((k) => k.path === path) ?? null;
	}

	/** The status pill of a path row (EI2). */
	statusOf(row: (typeof EDOC_PATH_ROWS)[number]): { key: string; tone: 'success' | 'pending' | 'danger' } {
		const s = this.settings();
		const chosen = row.kind === 'eInvoice' ? s?.eInvoicePath : s?.eWayBillPath;
		const enabled = !!s?.eInvoiceEnabledFrom;
		if (!row.automatic) {
			if (row.kind === 'eInvoice' && !enabled) return { key: 'edoc_status_waits_enablement', tone: 'pending' };
			return chosen === 'manual'
				? { key: 'edoc_status_active', tone: 'success' }
				: { key: 'edoc_status_fallback', tone: 'pending' };
		}
		const path = row.id as AutomaticEDocPath;
		const keys = this.keysOf(path);
		if (chosen === path) return { key: 'edoc_status_active', tone: 'success' };
		if (keys?.testOk === false) return { key: 'edoc_status_test_failed', tone: 'danger' };
		if (keys?.testOk) return { key: 'edoc_status_tested', tone: 'success' };
		if (keys) return { key: 'edoc_status_needs_test', tone: 'pending' };
		if (row.kind === 'eInvoice' && !enabled) return { key: 'edoc_status_waits_enablement', tone: 'pending' };
		return { key: 'edoc_status_no_keys', tone: 'pending' };
	}

	/** An automatic path can be picked only once its keys passed Test (AE1). */
	pickable(path: AutomaticEDocPath): boolean {
		return !!this.keysOf(path)?.testOk;
	}

	openKeys(path: AutomaticEDocPath): void {
		const keys = this.keysOf(path);
		const provider = keys?.provider ?? PATH_PROVIDERS[path][0]!;
		this.keysPath.set(path);
		this.provider.set(provider);
		this.environment.set(keys?.environment ?? 'sandbox');
		this.baseUrl.set(keys?.baseUrl ?? SANDBOX_URL[provider] ?? '');
		this.userName.set(keys?.userName ?? '');
		this.password.set('');
		this.clientId.set('');
		this.clientSecret.set('');
		this.publicKeyPem.set('');
	}

	providersOf(path: AutomaticEDocPath): EDocProvider[] {
		return PATH_PROVIDERS[path];
	}

	needsPublicKey(path: AutomaticEDocPath): boolean {
		return path === 'irpDirect' || path === 'ewbDirect';
	}

	private async run(task: () => Promise<EDocSettingsView>, success: string): Promise<boolean> {
		this.saving.set(true);
		try {
			const view = await task();
			this.queryClient.setQueryData(EDOC_KEYS.settings, view);
			this.notifier.showSuccess(this.transloco.translate(success));
			return true;
		} catch (error) {
			const code = (error as { error?: { error?: { message?: string } } }).error?.error?.message ?? '';
			const key = code.startsWith('edoc_') ? code.split(':')[0]! : 'edoc_save_failed';
			this.notifier.showError(this.transloco.translate(key));
			return false;
		} finally {
			this.saving.set(false);
		}
	}

	async save(): Promise<void> {
		if (!this.canEdit()) return;
		await this.run(
			() =>
				firstValueFrom(
					this.gateway.saveSettings(
						{
							eInvoicePath: this.eInvoicePath(),
							eWayBillPath: this.eWayBillPath(),
							eWayBillWithEInvoice: this.withEInvoice(),
							eInvoiceEnabledFrom: this.enabledFrom() || null,
							eWayBillThresholdINR: Math.max(0, Math.round(Number(this.threshold()) || 0)),
						},
						this.settings()?.updatedAt ?? null,
					),
				),
			'edoc_saved',
		);
	}

	async saveKeys(): Promise<void> {
		const path = this.keysPath();
		if (!path || !this.canEdit()) return;
		const ok = await this.run(
			() =>
				firstValueFrom(
					this.gateway.saveKeys({
						path,
						provider: this.provider(),
						environment: this.environment(),
						baseUrl: this.baseUrl().trim(),
						userName: this.userName().trim(),
						...(this.password() ? { password: this.password() } : {}),
						...(this.clientId() ? { clientId: this.clientId().trim() } : {}),
						...(this.clientSecret() ? { clientSecret: this.clientSecret() } : {}),
						...(this.publicKeyPem() ? { publicKeyPem: this.publicKeyPem().trim() } : {}),
					}),
				),
			'edoc_keys_saved',
		);
		if (ok) {
			this.password.set('');
			this.clientSecret.set('');
		}
	}

	async test(path: AutomaticEDocPath): Promise<void> {
		await this.run(() => firstValueFrom(this.gateway.test(path)), 'edoc_test_done');
	}

	async removeKeys(path: AutomaticEDocPath): Promise<void> {
		if (!this.canEdit()) return;
		await this.run(() => firstValueFrom(this.gateway.removeKeys(path)), 'edoc_keys_removed');
		if (this.keysPath() === path) this.keysPath.set(null);
	}
}
