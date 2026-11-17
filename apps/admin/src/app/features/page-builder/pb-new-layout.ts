import { Component, inject, signal } from '@angular/core';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { lastValueFrom } from 'rxjs';

import { type AdminLayoutRow, type AdminLayoutView, PageBuilderGateway } from '@core/page-builder/page-builder.gateway';

import { PbThumb } from './pb-thumb';

/**
 * New layout (brief A2): a name only admins see, and where to start: blank, or a copy of one of the page's layouts
 * with its sections and pictures. Closes with the new layout.
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
	readonly error = signal<string | null>(null);
	readonly creating = signal(false);

	start(pageType: string, layouts: AdminLayoutRow[]): void {
		this.pageType.set(pageType);
		this.layouts.set(layouts);
	}

	async create(): Promise<void> {
		const name = this.name().trim();
		if (!name || this.creating()) return;
		this.creating.set(true);
		try {
			const copyOf = this.copyOf();
			const made: AdminLayoutView = await lastValueFrom(
				this.gateway.createLayout(this.pageType(), { name, start: copyOf ? 'copy' : 'blank', copyOf }),
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
