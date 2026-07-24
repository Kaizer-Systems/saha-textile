import { Component, TemplateRef, inject, output, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';

import { ITableClickedAction } from '@data-access/interfaces/table.interface';

import { Button } from '../../button/button';

@Component({
	selector: 'app-delete-modal',
	templateUrl: './delete-modal.html',
	styleUrls: ['./delete-modal.scss'],
	imports: [Button, TranslocoModule],
})
export class DeleteModal {
	private modalService = inject(NgbModal);

	public closeResult: string;
	public modalOpen: boolean = false;
	public userAction = {};

	readonly DeleteModal = viewChild<TemplateRef<string>>('deleteModal');

	readonly deleteItem = output<ITableClickedAction>();

	async openModal(action: string, data: any) {
		this.modalOpen = true;
		this.userAction = {
			actionToPerform: action,
			data: data,
		};
		this.modalService
			.open(this.DeleteModal(), {
				ariaLabelledBy: 'Delete-Modal',
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

	delete(_modal: NgbModalRef) {
		this.deleteItem.emit(this.userAction);
	}

	ngOnDestroy() {
		if (this.modalOpen) {
			this.modalService.dismissAll();
		}
	}
}
