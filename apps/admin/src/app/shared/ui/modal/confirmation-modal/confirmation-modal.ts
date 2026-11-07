import { Component, TemplateRef, inject, output, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';

import { ITableClickedAction } from '@data-access/interfaces/table.interface';

import { Button } from '../../button/button';

@Component({
	selector: 'app-confirmation-modal',
	templateUrl: './confirmation-modal.html',
	styleUrls: ['./confirmation-modal.scss'],
	imports: [Button, TranslocoModule],
})
export class ConfirmationModal {
	private modalService = inject(NgbModal);

	public closeResult: string;
	public modalOpen: boolean = false;
	public userAction: ITableClickedAction;

	readonly ConfirmationModal = viewChild<TemplateRef<any>>('confirmationModal');

	readonly confirmed = output<ITableClickedAction>();

	async openModal(action: string, data?: any, value?: any) {
		this.modalOpen = true;
		this.userAction = {
			actionToPerform: action,
			data: data,
			value: value,
		};
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

	private getDismissReason(reason: ModalDismissReasons): string {
		if (reason === ModalDismissReasons.ESC) {
			return 'by pressing ESC';
		} else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
			return 'by clicking on a backdrop';
		} else {
			return `with: ${reason}`;
		}
	}

	confirm(modal: NgbModalRef) {
		modal.close('confirm');
		this.modalOpen = false;
		this.confirmed.emit(this.userAction);
	}

	ngOnDestroy() {
		if (this.modalOpen) {
			this.modalService.dismissAll();
		}
	}
}
