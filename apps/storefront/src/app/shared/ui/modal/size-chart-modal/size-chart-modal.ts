import { isPlatformBrowser } from '@angular/common';
import { Component, TemplateRef, PLATFORM_ID, inject, viewChild } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { IAttachment } from '@data-access/interfaces/attachment.interface';

import { Button } from '../../button/button';

@Component({
	selector: 'app-size-chart-modal',
	templateUrl: './size-chart-modal.html',
	styleUrls: ['./size-chart-modal.scss'],
	imports: [Button, TranslocoModule],
})
export class SizeChartModal {
	private modalService = inject(NgbModal);
	private platformId = inject<Object>(PLATFORM_ID);

	readonly SizeChartModal = viewChild<TemplateRef<string>>('sizeChartModal');

	public closeResult: string;
	public modalOpen: boolean = false;
	public image: IAttachment;

	async openModal(image: IAttachment) {
		if (isPlatformBrowser(this.platformId)) {
			this.image = image;
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
