import { isPlatformBrowser } from '@angular/common';
import { Component, TemplateRef, PLATFORM_ID, inject, viewChild, output } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal, ModalDismissReasons } from '@ng-bootstrap/ng-bootstrap';

import { Button } from '../../button/button';

@Component({
	selector: 'app-confirmation-modal',
	templateUrl: './confirmation-modal.html',
	styleUrls: ['./confirmation-modal.scss'],
	imports: [Button, TranslocoModule],
})
export class ConfirmationModal {
	private modalService = inject(NgbModal);
	private platformId = inject<Object>(PLATFORM_ID);

	public closeResult: string;
	public modalOpen: boolean = false;

	readonly ConfirmationModal = viewChild<TemplateRef<ConfirmationModal>>('confirmationModal');

	readonly confirmed = output<boolean>();

	async openModal() {
		if (isPlatformBrowser(this.platformId)) {
			this.modalOpen = true;
			this.modalService
				.open(this.ConfirmationModal(), {
					ariaLabelledBy: 'Confirmation-Modal',
					centered: true,
					windowClass: 'theme-modal text-center',
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

	confirm() {
		this.confirmed.emit(true);
		this.modalService.dismissAll();
	}

	ngOnDestroy() {
		if (this.modalOpen) {
			this.modalService.dismissAll();
		}
	}
}
