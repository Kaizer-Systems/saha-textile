import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
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
	PageBuilderGateway,
} from '@core/page-builder/page-builder.gateway';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { PbNewLayout } from './pb-new-layout';
import { PbThumb } from './pb-thumb';

/** One line of "What shoppers see, and when". */
interface WhenRow {
	from: string | null;
	name: string;
	back: boolean;
	status: 'live' | 'scheduled';
}

/** Badge classes per layout status (theme badges; the ended chip is the Media brief's muted chip). */
export const STATUS_CLASS: Record<AdminLayoutRow['status'], string> = {
	live: 'badge bg-success',
	scheduled: 'badge bg-info text-dark',
	draft: 'badge bg-warning text-dark',
	ended: 'fm-chip muted',
};

/**
 * Page Builder › Home (brief A1): what shoppers see and when, the page's layouts as cards with their status, and
 * the page's templates (Q9 A). New layout, or Use this on a template, opens A2. The builder itself (Edit) and Go Live come with their own build steps.
 */
@Component({
	selector: 'app-page-builder-home',
	templateUrl: './page-builder-home.html',
	imports: [DatePipe, PageWrapper, PbThumb, RouterLink, TranslocoModule],
})
export class PageBuilderHome {
	private readonly gateway = inject(PageBuilderGateway);
	private readonly modals = inject(NgbModal);
	private readonly toastr = inject(ToastrService);
	private readonly transloco = inject(TranslocoService);
	readonly pageType = (inject(ActivatedRoute).snapshot.paramMap.get('type') ?? 'home').toLowerCase();
	readonly page = signal<AdminBuilderPage | null>(null);
	readonly statusClass = STATUS_CLASS;

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
		if (live) rows.push({ from: live.from, name: names.get(live.layoutId) ?? '', back: false, status: 'live' });
		const now = Date.now();
		for (const entry of [...page.schedule].sort((a, b) => Date.parse(a.from) - Date.parse(b.from))) {
			if (Date.parse(entry.from) > now)
				rows.push({
					from: entry.from,
					name: names.get(entry.layoutId) ?? '',
					back: false,
					status: 'scheduled',
				});
			if (entry.until && Date.parse(entry.until) > now && live && entry.layoutId !== live.layoutId) {
				rows.push({ from: entry.until, name: names.get(live.layoutId) ?? '', back: true, status: 'scheduled' });
			}
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
