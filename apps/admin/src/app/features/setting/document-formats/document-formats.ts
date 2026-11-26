import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { AuthStore } from '@core/state/auth.store';
import { DocumentFormatService } from '@data-access/services/document-format.service';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import { MakeLayoutPopup } from './make-layout-popup';

import type { DocumentFormat, DocumentKind } from '@saha-textile/contracts';

export const DOCUMENT_FORMATS_QUERY_KEY = ['document-formats'] as const;

/** A note under the page title (F02) or under one document's table (F03). */
interface Note {
	kind: 'success' | 'warning';
	doc: DocumentKind;
	key: string;
	params: Record<string, string>;
}

/**
 * Settings › Document formats (bundle builder brief F01–F04, approved 2026-11-22): every document in its own table,
 * grouped Sales, Orders and parcels, Purchases, Stock and accounts. Exactly one active format per document:
 * switching one on switches the other off (F02); the active one can't be switched off (F03). Make new layout picks
 * the document and opens its builder (F04).
 */
@Component({
	selector: 'app-document-formats',
	templateUrl: './document-formats.html',
	imports: [PageWrapper, RouterLink, TranslocoModule, HasPermissionDirective, DatePipe, FormsModule],
})
export class DocumentFormatsSettings {
	private readonly service = inject(DocumentFormatService);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly modal = inject(NgbModal);
	private readonly router = inject(Router);
	private readonly auth = inject(AuthStore);

	readonly query = injectQuery(() => ({
		queryKey: DOCUMENT_FORMATS_QUERY_KEY,
		queryFn: () => firstValueFrom(this.service.list()),
	}));
	readonly groups = computed(() => this.query.data()?.groups ?? []);
	readonly loading = computed(() => this.query.isPending());
	readonly canEdit = computed(() => this.auth.permissions().includes('setting.edit'));
	readonly note = signal<Note | null>(null);
	readonly busy = signal<string | null>(null);

	docName(doc: DocumentKind): string {
		return this.transloco.translate(`docf_doc_${doc}`);
	}

	/** A switch was clicked: on → this format prints from now on (F02); off → refused with the reason (F03). */
	async toggle(format: DocumentFormat, event: Event): Promise<void> {
		const input = event.target as HTMLInputElement;
		input.checked = format.active;
		if (this.busy()) return;
		this.busy.set(format.id);
		try {
			if (format.active) {
				await firstValueFrom(this.service.switchOff(format.id)).catch((error: unknown) => {
					const code = (error as { error?: { code?: string } }).error?.code ?? '';
					this.note.set({
						kind: 'warning',
						doc: format.doc,
						key: code === 'document_format_switch_another' ? 'docf_switch_another' : 'docf_only_format',
						params: { doc: this.docName(format.doc) },
					});
				});
				return;
			}
			const result = await firstValueFrom(this.service.switchOn(format.id));
			this.note.set({
				kind: 'success',
				doc: format.doc,
				key: result.switchedOff ? 'docf_switched' : 'docf_switched_alone',
				params: { doc: this.docName(format.doc), on: result.active.name, off: result.switchedOff?.name ?? '' },
			});
			await this.queryClient.invalidateQueries({ queryKey: DOCUMENT_FORMATS_QUERY_KEY });
		} catch {
			this.notifier.showError(this.transloco.translate('docf_switch_failed'));
		} finally {
			this.busy.set(null);
		}
	}

	async duplicate(format: DocumentFormat): Promise<void> {
		const copy = await firstValueFrom(this.service.duplicate(format.id)).catch(() => null);
		if (!copy) {
			this.notifier.showError(this.transloco.translate('docf_copy_failed'));
			return;
		}
		await this.queryClient.invalidateQueries({ queryKey: DOCUMENT_FORMATS_QUERY_KEY });
		this.notifier.showSuccess(this.transloco.translate('docf_copied', { name: copy.name }));
	}

	/** Eye: the format with its document's example, opened as a PDF; download saves it. */
	async pdf(format: DocumentFormat, save: boolean): Promise<void> {
		this.busy.set(`pdf:${format.id}`);
		try {
			const blob = await firstValueFrom(this.service.pdf(format.id));
			const url = URL.createObjectURL(blob);
			if (save) {
				const link = document.createElement('a');
				link.href = url;
				link.download = `${format.name} - ${this.docName(format.doc)}.pdf`;
				link.click();
			} else {
				window.open(url, '_blank', 'noopener');
			}
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
		} catch {
			this.notifier.showError(this.transloco.translate('docf_pdf_failed'));
		} finally {
			this.busy.set(null);
		}
	}

	/** Make new layout (F04): the pop-up picks the document and the start; the builder opens on the new layout. */
	async makeNew(): Promise<void> {
		const ref = this.modal.open(MakeLayoutPopup, { centered: true, size: 'lg', windowClass: 'theme-modal' });
		const choice = (await ref.result.catch(() => null)) as {
			doc: DocumentKind;
			from: 'ours' | 'blank';
			name: string;
		} | null;
		if (!choice) return;
		const made = await firstValueFrom(this.service.create(choice)).catch(() => null);
		if (!made) {
			this.notifier.showError(this.transloco.translate('docf_make_failed'));
			return;
		}
		await this.queryClient.invalidateQueries({ queryKey: DOCUMENT_FORMATS_QUERY_KEY });
		await this.router.navigate(['/setting/document-formats', made.id]);
	}
}
