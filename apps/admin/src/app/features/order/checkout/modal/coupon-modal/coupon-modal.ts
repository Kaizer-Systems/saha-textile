import { Component, TemplateRef, inject, viewChild } from '@angular/core';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';

@Component({
	selector: 'app-coupon-modal',
	templateUrl: './coupon-modal.html',
	styleUrls: ['./coupon-modal.scss'],
	standalone: true,
})
export class CouponModal {
	private modalService = inject(NgbModal);

	public closeResult: string;
	public modalOpen: boolean = false;

	readonly CouponModal = viewChild<TemplateRef<string>>('couponModal');

	async openModal() {
		this.modalOpen = true;
		this.modalService
			.open(this.CouponModal(), {
				ariaLabelledBy: 'add-customer-Modal',
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
