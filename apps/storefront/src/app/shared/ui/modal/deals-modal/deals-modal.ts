import { isPlatformBrowser } from '@angular/common';
import { Component, TemplateRef, PLATFORM_ID, inject, viewChild, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

import { Button } from '../../button/button';
import { NoData } from '../../no-data/no-data';

@Component({
	selector: 'app-deals-modal',
	templateUrl: './deals-modal.html',
	styleUrls: ['./deals-modal.scss'],
	providers: [CurrencySymbolPipe],
	imports: [Button, RouterLink, NoData, TranslocoModule, CurrencySymbolPipe],
})
export class DealsModal {
	private modalService = inject(NgbModal);
	private platformId = inject<Object>(PLATFORM_ID);

	readonly dealsModal = viewChild<TemplateRef<DealsModal>>('dealsModal');

	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly products = input<IProduct[]>();

	public closeResult: string;
	public modalOpen: boolean = false;

	async openModal() {
		if (isPlatformBrowser(this.platformId)) {
			this.modalOpen = true;
			this.modalService
				.open(this.dealsModal(), {
					ariaLabelledBy: 'Deal-Modal',
					centered: true,
					windowClass: 'theme-modal deal-modal',
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

	private getDismissReason(reason: ModalDismissReasons): string {
		if (reason === ModalDismissReasons.ESC) {
			return 'by pressing ESC';
		} else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
			return 'by clicking on a backdrop';
		} else {
			return `with: ${reason}`;
		}
	}

	closeModal() {
		this.modalService.dismissAll();
	}
}
