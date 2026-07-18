import { Component, TemplateRef, inject, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal, ModalDismissReasons } from '@ng-bootstrap/ng-bootstrap';

import { FormShipping } from '../../form-shipping/form-shipping';

@Component({
	selector: 'app-shipping-rule-modal',
	templateUrl: './shipping-rule-modal.html',
	styleUrls: ['./shipping-rule-modal.scss'],
	imports: [FormShipping, TranslocoModule],
})
export class ShippingRuleModal {
	private modalService = inject(NgbModal);

	public closeResult: string;
	public modalOpen: boolean = false;

	readonly CreateShippingRuleModal = viewChild<TemplateRef<string>>('createShippingRuleModal');

	async openModal() {
		this.modalOpen = true;
		this.modalService
			.open(this.CreateShippingRuleModal(), {
				ariaLabelledBy: 'shipping-rule-Modal',
				centered: true,
				windowClass: 'theme-modal shipping-rule-modal modal-lg',
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

	private getDismissReason(reason: ModalDismissReasons): string {
		if (reason === ModalDismissReasons.ESC) {
			return 'by pressing ESC';
		} else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
			return 'by clicking on a backdrop';
		} else {
			return `with: ${reason}`;
		}
	}

	ngOnDestroy() {
		if (this.modalOpen) {
			this.modalService.dismissAll();
		}
	}
}
