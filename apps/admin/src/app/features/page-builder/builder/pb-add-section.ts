import { Component, inject, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { type AdminSavedBlockRow, type PageSection, PageBuilderGateway } from '@core/page-builder/page-builder.gateway';

import { PbThumb } from '../pb-thumb';

/** What Add section hands back: a new section of a type, or a saved block as a copy or linked (Q18 A: copy). */
export type PbAddChoice =
	| { kind: 'type'; type: PageSection['type'] }
	| { kind: 'block'; block: AdminSavedBlockRow['block']; linked: boolean };

/**
 * Add section (brief B2): only the sections the shop already has and this page allows, each with its outline picture
 * and one line on what it is for (SG-31); then the saved blocks (P7), added as a copy unless "linked" is chosen.
 */
@Component({
	selector: 'app-pb-add-section',
	templateUrl: './pb-add-section.html',
	imports: [PbThumb, TranslocoModule],
})
export class PbAddSection {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(PageBuilderGateway);
	readonly types = signal<PageSection['type'][]>([]);
	readonly blocks = signal<AdminSavedBlockRow[]>([]);
	readonly linked = signal(false);

	start(allowed: readonly PageSection['type'][]): void {
		this.types.set([...allowed]);
		this.gateway.blocks().subscribe({
			next: (rows) => this.blocks.set(rows.filter((row) => allowed.includes(row.block.section.type))),
			error: () => this.blocks.set([]),
		});
	}

	outline(type: PageSection['type']) {
		return [{ type, arrangement: type === 'banner_arrangement' ? ('hero_full' as const) : null }];
	}

	pickType(type: PageSection['type']): void {
		this.modal.close({ kind: 'type', type } satisfies PbAddChoice);
	}

	pickBlock(row: AdminSavedBlockRow): void {
		this.modal.close({ kind: 'block', block: row.block, linked: this.linked() } satisfies PbAddChoice);
	}
}
