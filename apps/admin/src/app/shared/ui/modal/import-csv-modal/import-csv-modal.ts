import { Component, inject, input, TemplateRef, viewChild } from '@angular/core';

import {
	ModalDismissReasons,
	NgbModal,
	NgbNav,
	NgbNavContent,
	NgbNavItem,
	NgbNavItemRole,
	NgbNavLink,
	NgbNavLinkBase,
	NgbNavOutlet,
} from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { NgxDropzoneChangeEvent, NgxDropzoneModule } from 'ngx-dropzone';

import { Button } from '../../button/button';

@Component({
	selector: 'app-import-csv-modal',
	templateUrl: './import-csv-modal.html',
	styleUrls: ['./import-csv-modal.scss'],
	imports: [
		Button,
		NgbNav,
		NgbNavItem,
		NgbNavItemRole,
		NgbNavLink,
		NgbNavLinkBase,
		NgbNavContent,
		NgxDropzoneModule,
		NgbNavOutlet,
		TranslateModule,
	],
})
export class ImportCsvModal {
	private modalService = inject(NgbModal);

	public active = 'upload';
	public closeResult: string;
	public modalOpen: boolean = false;

	public files: File[] = [];

	readonly module = input<string>(undefined);

	readonly CSVModal = viewChild<TemplateRef<string>>('csvModal');

	async openModal() {
		this.modalOpen = true;
		this.modalService
			.open(this.CSVModal(), {
				ariaLabelledBy: 'Media-Modal',
				centered: true,
				windowClass: 'theme-modal modal-xl media-modal',
			})
			.result.then(
				(result) => {
					`Result ${result}`;
					this.closeResult = `Closed with: ${result}`;
				},
				(reason) => {
					this.closeResult = `Dismissed ${this.getDismissReason(reason)}`;
				},
			);
	}

	private getDismissReason(reason: ModalDismissReasons): string {
		this.active = 'upload';
		if (reason === ModalDismissReasons.ESC) {
			return 'by pressing ESC';
		} else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
			return 'by clicking on a backdrop';
		} else {
			return `with: ${reason}`;
		}
	}

	onSelect(event: NgxDropzoneChangeEvent) {
		this.files.push(...event.addedFiles);
	}

	onRemove(event: File) {
		this.files.splice(this.files.indexOf(event), 1);
	}

	upload() {
		const module = this.module();
		if (this.files.length && module) {
			if (module == 'user') {
				// Import has no backend yet — just reset and close.
				this.files = [];
				this.modalService.dismissAll();
			}
		}
	}

	ngOnDestroy() {
		if (this.modalOpen) {
			this.modalService.dismissAll();
		}
	}
}
