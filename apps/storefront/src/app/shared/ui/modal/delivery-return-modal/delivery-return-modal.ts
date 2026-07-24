import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, TemplateRef, inject, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslocoModule } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Observable } from 'rxjs';

import { SiteConfigStore } from '@core/state/site-config.store';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';

import { Button } from '../../button/button';

@Component({
	selector: 'app-delivery-return-modal',
	templateUrl: './delivery-return-modal.html',
	styleUrls: ['./delivery-return-modal.scss'],
	imports: [Button, TranslocoModule],
})
export class DeliveryReturnModal {
	private modalService = inject(NgbModal);
	private platformId = inject<Object>(PLATFORM_ID);

	readonly DeliveryReturnModal = viewChild<TemplateRef<string>>('deliveryReturnModal');

	siteConfig$: Observable<ISiteConfig> = toObservable(inject(SiteConfigStore).siteConfig) as Observable<ISiteConfig>;

	public closeResult: string;
	public modalOpen: boolean = false;
	public policy: string;

	async openModal(value: string) {
		if (isPlatformBrowser(this.platformId)) {
			this.policy = value;
			this.modalOpen = true;
			this.modalService
				.open(this.DeliveryReturnModal(), {
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
