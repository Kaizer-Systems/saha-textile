import { Component, inject, signal } from '@angular/core';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { lastValueFrom } from 'rxjs';

import {
	type AdminBuilderPage,
	type AdminLayoutRow,
	type AdminLayoutView,
	PageBuilderGateway,
} from '@core/page-builder/page-builder.gateway';

import { PbThumb } from './pb-thumb';

/**
 * New layout (brief A2): a name only admins see, and where to start: blank, a copy of one of the page's layouts
 * with its sections and pictures, or a template (Q9 A), whose sections then stay in place (Q8 A). With a template,
 * the switch brings today's pictures into the pieces with the same name. Closes with the new layout.
 */
@Component({
	selector: 'app-pb-new-layout',
	templateUrl: './pb-new-layout.html',
	imports: [PbThumb, TranslocoModule],
})
export class PbNewLayout {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(PageBuilderGateway);
	private readonly toastr = inject(ToastrService);
	private readonly transloco = inject(TranslocoService);

	readonly pageType = signal('home');
	readonly layouts = signal<AdminLayoutRow[]>([]);
	readonly name = signal('');
	/** null: blank; otherwise the layout to copy. */
	readonly copyOf = signal<string | null>(null);
	readonly templates = signal<AdminBuilderPage['templates']>([]);
	/** A template to start from; null: blank or a copy. */
	readonly template = signal<string | null>(null);
	readonly bringPictures = signal(true);
	readonly error = signal<string | null>(null);
	readonly creating = signal(false);

	start(
		pageType: string,
		layouts: AdminLayoutRow[],
		templates: AdminBuilderPage['templates'] = [],
		template: string | null = null,
	): void {
		this.pageType.set(pageType);
		this.layouts.set(layouts);
		this.templates.set(templates);
		this.template.set(template);
	}

	choose(choice: { copyOf?: string; template?: string } | null): void {
		this.copyOf.set(choice?.copyOf ?? null);
		this.template.set(choice?.template ?? null);
	}

	async create(): Promise<void> {
		const name = this.name().trim();
		if (!name || this.creating()) return;
		this.creating.set(true);
		try {
			const copyOf = this.copyOf();
			const template = this.template();
			const start = template ? 'template' : copyOf ? 'copy' : 'blank';
			const made: AdminLayoutView = await lastValueFrom(
				this.gateway.createLayout(this.pageType(), {
					name,
					start,
					copyOf: start === 'copy' ? copyOf : null,
					template,
					bringPictures: this.bringPictures(),
				}),
			);
			this.modal.close(made);
			this.toastr.success(this.transloco.translate('pb_layout_created'));
		} catch (error) {
			this.error.set(readApiErrorMessage(error) ?? this.transloco.translate('pb_action_failed'));
		} finally {
			this.creating.set(false);
		}
	}
}
