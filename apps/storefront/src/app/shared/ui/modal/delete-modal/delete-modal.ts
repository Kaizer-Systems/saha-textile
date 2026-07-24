import { isPlatformBrowser } from '@angular/common';
import { Component, TemplateRef, PLATFORM_ID, inject, viewChild, output } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal, ModalDismissReasons } from '@ng-bootstrap/ng-bootstrap';

import { Button } from '../../button/button';

@Component({
	selector: 'app-delete-modal',
	templateUrl: './delete-modal.html',
	styleUrls: ['./delete-modal.scss'],
	imports: [Button, TranslocoModule],
})
export class DeleteModal {
	private modalService = inject(NgbModal);
	private platformId = inject<Object>(PLATFORM_ID);

	public closeResult: string;
	public modalOpen: boolean = false;
	public userAction = {};

	readonly DeleteModal = viewChild<TemplateRef<string>>('deleteModal');

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- emits arbitrary domain items (product/address/etc.)
	readonly deleteItem = output<any>();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary payload stored for deferred action
	async openModal(action: string, data: any) {
		if (isPlatformBrowser(this.platformId)) {
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

	delete() {
		this.deleteItem.emit(this.userAction);
	}

	ngOnDestroy() {
		if (this.modalOpen) {
			this.modalService.dismissAll();
		}
	}
}
