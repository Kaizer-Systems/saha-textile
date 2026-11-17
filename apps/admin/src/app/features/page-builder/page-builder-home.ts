import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { languageName } from '@saha-textile/core-domain/languages';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { lastValueFrom } from 'rxjs';

import {
	type AdminBuilderPage,
	type AdminLayoutRow,
	type LayoutExport,
	type PageSalesRow,
	PageBuilderGateway,
} from '@core/page-builder/page-builder.gateway';
import { AuthStore } from '@core/state/auth.store';
import { type ITableClickedAction } from '@data-access/interfaces/table.interface';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { ConfirmationModal } from '@shared/ui/modal/confirmation-modal/confirmation-modal';

import { PbNewLayout } from './pb-new-layout';
import { PbThumb } from './pb-thumb';

/** One line of "What shoppers see, and when". */
interface WhenRow {
	from: string | null;
	name: string;
	back: boolean;
	status: 'live' | 'scheduled' | 'waiting';
	/** A switch still to come that can be cancelled, or a Go Live waiting for pictures that can be taken off. */
	cancel: { revisionId: string; from: string } | null;
	waitingLayoutId: string | null;
}

/** Badge classes per layout status (theme badges; the ended chip is the Media brief's muted chip). */
export const STATUS_CLASS: Record<AdminLayoutRow['status'] | 'waiting', string> = {
	live: 'badge bg-success',
	scheduled: 'badge bg-info text-dark',
	waiting: 'badge bg-warning text-dark',
	draft: 'badge bg-warning text-dark',
	ended: 'fm-chip muted',
};

/**
 * Page Builder › Home (brief A1): what shoppers see and when, the page's layouts as cards with their status, and
 * the page's templates (Q9 A). New layout, or Use this on a template, opens A2; Edit opens the builder. Those who may go
 * live (Q10 A) also cancel a switch still to come, put back the previous layout (SG-15), take off a Go Live waiting for
 * pictures (E5) and, as super admins, switch safe mode (SG-15); each asks first.
 */
@Component({
	selector: 'app-page-builder-home',
	templateUrl: './page-builder-home.html',
	imports: [ConfirmationModal, DatePipe, DecimalPipe, PageWrapper, PbThumb, RouterLink, TranslocoModule],
})
export class PageBuilderHome {
	private readonly gateway = inject(PageBuilderGateway);
	private readonly modals = inject(NgbModal);
	private readonly toastr = inject(ToastrService);
	private readonly transloco = inject(TranslocoService);
	readonly pageType = (inject(ActivatedRoute).snapshot.paramMap.get('type') ?? 'home').toLowerCase();
	readonly page = signal<AdminBuilderPage | null>(null);
	readonly statusClass = STATUS_CLASS;
	readonly confirm = viewChild<ConfirmationModal>('confirmationModal');
	/** Q10 A: going live and changing the schedule are for the owner and super admins. */
	private readonly auth = inject(AuthStore);
	readonly canGoLive = computed(() => this.auth.permissions().includes('page_builder.go_live'));
	/** SG-23 shows money, so it needs the revenue permission too. */
	readonly canSeeSales = computed(() => this.auth.permissions().includes('dashboard.revenue'));
	readonly sales = signal<PageSalesRow[] | null>(null);

	/** Page settings each shop language still lacks (P3), with the language named in its own script. */
	readonly settingsTodo = computed(() =>
		Object.entries(this.page()?.settingsGaps ?? {}).map(([locale, fields]) => ({
			locale,
			language: languageName(locale),
			count: fields.length,
		})),
	);

	/** The schedule from now on, with layout names: the live entry, then each switch to come. */
	readonly when = computed<WhenRow[]>(() => {
		const page = this.page();
		if (!page) return [];
		const names = new Map(page.layouts.map((row) => [row.layout.id, row.layout.name]));
		const rows: WhenRow[] = [];
		const live = page.schedule.find((entry) => entry.revisionId === page.liveRevisionId);
		const none = { cancel: null, waitingLayoutId: null };
		if (live)
			rows.push({ from: live.from, name: names.get(live.layoutId) ?? '', back: false, status: 'live', ...none });
		const now = Date.now();
		for (const entry of [...page.schedule].sort((a, b) => Date.parse(a.from) - Date.parse(b.from))) {
			if (Date.parse(entry.from) > now)
				rows.push({
					from: entry.from,
					name: names.get(entry.layoutId) ?? '',
					back: false,
					status: 'scheduled',
					cancel: { revisionId: entry.revisionId, from: entry.from },
					waitingLayoutId: null,
				});
			if (entry.until && Date.parse(entry.until) > now && live && entry.layoutId !== live.layoutId) {
				rows.push({
					from: entry.until,
					name: names.get(live.layoutId) ?? '',
					back: true,
					status: 'scheduled',
					...none,
				});
			}
		}
		for (const waiting of page.waiting) {
			rows.push({
				from: waiting.from,
				name: waiting.layoutName,
				back: false,
				status: 'waiting',
				cancel: null,
				waitingLayoutId: waiting.layoutId,
			});
		}
		return rows;
	});

	constructor() {
		this.load();
	}

	load(): void {
		this.gateway.page(this.pageType).subscribe({
			next: (page) => this.page.set(page),
			error: (error) =>
				this.toastr.error(readApiErrorMessage(error) ?? this.transloco.translate('pb_action_failed')),
		});
		if (this.canSeeSales()) {
			this.gateway.sales(this.pageType).subscribe({
				next: (answer) => this.sales.set(answer.rows),
				error: () => this.sales.set([]),
			});
		}
	}

	/** SG-22: the layout as a file, saved by the browser. */
	async exportLayout(row: AdminLayoutRow): Promise<void> {
		try {
			const file = await lastValueFrom(this.gateway.exportLayout(row.layout.id));
			const blob = new Blob([JSON.stringify(file, null, '\t')], { type: 'application/json' });
			const link = document.createElement('a');
			link.href = URL.createObjectURL(blob);
			link.download = `${
				row.layout.name
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-|-$/g, '') || 'layout'
			}.layout.json`;
			link.click();
			setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
		} catch (error) {
			this.toastr.error(readApiErrorMessage(error) ?? this.transloco.translate('pb_action_failed'));
		}
	}

	/** SG-22: a layout file from another environment becomes a new layout; the API checks every section. */
	async importLayout(input: HTMLInputElement): Promise<void> {
		const chosen = input.files?.[0];
		input.value = '';
		if (!chosen) return;
		try {
			const file = JSON.parse(await chosen.text()) as LayoutExport;
			await lastValueFrom(this.gateway.importLayout(this.pageType, file));
			this.toastr.success(this.transloco.translate('pb_imported'));
			this.load();
		} catch (error) {
			this.toastr.error(readApiErrorMessage(error) ?? this.transloco.translate('pb_import_refused'));
		}
	}

	/** Asks first (the admin's own confirmation), then changes the schedule or the safe mode. */
	ask(action: 'cancel_switch' | 'cancel_waiting' | 'put_back' | 'safe_on' | 'safe_off', data?: unknown): void {
		void this.confirm()?.openModal(action, data);
	}

	async confirmed(action: ITableClickedAction): Promise<void> {
		const type = this.pageType;
		const calls = {
			cancel_switch: () => this.gateway.cancelSwitch(type, action.data as { revisionId: string; from: string }),
			cancel_waiting: () => this.gateway.cancelWaiting(type, action.data as string),
			put_back: () => this.gateway.putBack(type),
			safe_on: () => this.gateway.safeMode(type, true),
			safe_off: () => this.gateway.safeMode(type, false),
		} as const;
		const call = calls[action.actionToPerform as keyof typeof calls];
		if (!call) return;
		try {
			this.page.set(await lastValueFrom(call()));
			this.toastr.success(this.transloco.translate('pb_done_' + action.actionToPerform));
		} catch (error) {
			this.toastr.error(readApiErrorMessage(error) ?? this.transloco.translate('pb_action_failed'));
		}
	}

	async newLayout(template: string | null = null): Promise<void> {
		const ref = this.modals.open(PbNewLayout, { centered: true, size: 'lg' });
		(ref.componentInstance as PbNewLayout).start(
			this.pageType,
			this.page()?.layouts ?? [],
			this.page()?.templates ?? [],
			template,
		);
		const made = await ref.result.catch(() => null);
		if (made) this.load();
	}

	async duplicate(row: AdminLayoutRow): Promise<void> {
		try {
			await lastValueFrom(
				this.gateway.createLayout(this.pageType, {
					name: this.transloco.translate('pb_copy_name', { name: row.layout.name }),
					start: 'copy',
					copyOf: row.layout.id,
					template: null,
					bringPictures: true,
				}),
			);
			this.toastr.success(this.transloco.translate('pb_layout_created'));
			this.load();
		} catch (error) {
			this.toastr.error(readApiErrorMessage(error) ?? this.transloco.translate('pb_action_failed'));
		}
	}
}
