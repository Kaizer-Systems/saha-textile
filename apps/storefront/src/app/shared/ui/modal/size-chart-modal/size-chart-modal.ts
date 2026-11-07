import { isPlatformBrowser } from '@angular/common';
import { Component, TemplateRef, PLATFORM_ID, inject, signal, viewChild } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { ISizeGuide } from '@data-access/interfaces/product-detail.interface';

import { Button } from '../../button/button';

type Unit = 'in' | 'cm';

const CM_PER_INCH = 2.54;

/** The measurement template's size table. Inches first, because the shop's tailors work in them. */
@Component({
	selector: 'app-size-chart-modal',
	templateUrl: './size-chart-modal.html',
	styleUrls: ['./size-chart-modal.scss'],
	imports: [Button, TranslocoModule],
})
export class SizeChartModal {
	private modalService = inject(NgbModal);
	private platformId = inject<Object>(PLATFORM_ID);
	private transloco = inject(TranslocoService);

	readonly SizeChartModal = viewChild<TemplateRef<string>>('sizeChartModal');

	public closeResult: string;
	public modalOpen: boolean = false;
	readonly guide = signal<ISizeGuide | null>(null);
	readonly unit = signal<Unit>('in');

	async openModal(guide: ISizeGuide) {
		if (isPlatformBrowser(this.platformId)) {
			this.guide.set(guide);
			this.unit.set('in');
			this.modalOpen = true;
			this.modalService
				.open(this.SizeChartModal(), {
					ariaLabelledBy: 'profile-Modal',
					centered: true,
					windowClass: 'theme-modal modal-lg',
				})
				.result.then(
					(result) => {
						`Result ${result}`;
					},
					(reason) => {
						this.closeResult = `Dismissed ${this.getDismissReason(reason)}`;
					},
				);
		}
	}

	/** One measure in the chosen unit, written the way the shopper's language writes numbers. */
	cell(value: number | undefined, stored: Unit): string {
		if (value === undefined) return '-';
		const shown = stored === this.unit() ? value : stored === 'in' ? value * CM_PER_INCH : value / CM_PER_INCH;
		return new Intl.NumberFormat(this.transloco.getActiveLang(), { maximumFractionDigits: 1 }).format(shown);
	}

	private getDismissReason(reason: ModalDismissReasons): string {
		if (reason === ModalDismissReasons.ESC) {
			return 'by pressing ESC';
		} else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
			return 'by clicking on a backdrop';
		} else {
			return `with: ${reason}`;
		}
	}
}
