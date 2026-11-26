import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { lastValueFrom } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { type RevisionRow, PageBuilderGateway } from '@core/page-builder/page-builder.gateway';

/** One change made in this session, as History lists it (E3); undo goes back through these. */
export interface SessionLine {
	at: Date;
	key: string;
	params: Record<string, unknown>;
	/** How many undo steps this line stands for (repeated edits of one section show once). */
	steps: number;
}

/**
 * History (brief E3, Q12 A): this session's changes, newest first, and the layout's saved revisions with who saved
 * each and when it went live. Look opens a saved revision on the shop in a new tab (a one-time code, as the preview
 * does); Bring back makes it the draft again as a new revision, so nothing is lost.
 */
@Component({
	selector: 'app-pb-history',
	templateUrl: './pb-history.html',
	imports: [DatePipe, TranslocoModule],
})
export class PbHistory {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(PageBuilderGateway);
	private readonly transloco = inject(TranslocoService);

	readonly name = signal('');
	readonly session = signal<SessionLine[]>([]);
	readonly revisions = signal<RevisionRow[] | null>(null);
	readonly error = signal<string | null>(null);
	readonly readOnly = signal(false);
	private layoutId = '';
	private pageType = 'home';
	private locale = 'en';

	start(input: {
		layoutId: string;
		pageType: string;
		locale: string;
		name: string;
		session: SessionLine[];
		readOnly: boolean;
	}): void {
		this.layoutId = input.layoutId;
		this.pageType = input.pageType;
		this.locale = input.locale;
		this.name.set(input.name);
		this.session.set([...input.session].reverse());
		this.readOnly.set(input.readOnly);
		this.gateway.history(input.layoutId).subscribe({
			next: (answer) => this.revisions.set(answer.revisions),
			error: (error) =>
				this.error.set(readApiErrorMessage(error) ?? this.transloco.translate('pb_action_failed')),
		});
	}

	/** Opens a saved revision as the shop draws it, in a new tab; the code works once, within a minute. */
	async look(row: RevisionRow): Promise<void> {
		const tab = window.open('', '_blank');
		try {
			const { code } = await lastValueFrom(this.gateway.previewCode(this.layoutId, row.id));
			const shop = runtimeConfig.siteUrl.replace(/\/$/, '');
			const url = `${shop}/${encodeURIComponent(this.locale)}/__preview/${encodeURIComponent(this.pageType)}?code=${encodeURIComponent(code)}`;
			if (tab) {
				tab.opener = null;
				tab.location.href = url;
			}
		} catch (error) {
			tab?.close();
			this.error.set(readApiErrorMessage(error) ?? this.transloco.translate('pb_action_failed'));
		}
	}

	bringBack(row: RevisionRow): void {
		this.modal.close({ bringBack: row.id });
	}
}
