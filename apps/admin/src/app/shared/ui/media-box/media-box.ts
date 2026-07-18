import { AsyncPipe } from '@angular/common';
import {
	Component,
	DOCUMENT,
	effect,
	Injector,
	Input,
	Renderer2,
	inject,
	input,
	output,
	signal,
	viewChild,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbDropdown, NgbDropdownItem, NgbDropdownMenu, NgbDropdownToggle } from '@ng-bootstrap/ng-bootstrap';
import { Observable, debounceTime, distinctUntilChanged } from 'rxjs';

import { IAttachment, IAttachmentModel } from '@data-access/interfaces/attachment.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { injectAttachmentsQuery } from '@data-access/queries/attachment.queries';
import { Loader } from '@layout/loader/loader';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { DeleteModal, DeleteModal as DeleteModalComponent_1 } from '@shared/ui/modal/delete-modal/delete-modal';

import { NoData } from '../no-data/no-data';
import { Pagination } from '../pagination/pagination';

@Component({
	selector: 'app-media-box',
	templateUrl: './media-box.html',
	styleUrls: ['./media-box.scss'],
	imports: [
		ReactiveFormsModule,
		Loader,
		HasPermissionDirective,
		NgbDropdown,
		NgbDropdownToggle,
		NgbDropdownMenu,
		NgbDropdownItem,
		Pagination,
		NoData,
		DeleteModalComponent_1,
		TranslocoModule,
		AsyncPipe,
	],
})
export class MediaBox {
	private document = inject<Document>(DOCUMENT);
	private renderer = inject(Renderer2);

	readonly DeleteModal = viewChild<DeleteModal>('deleteModal');

	// TODO: Skipped for migration because:
	//  Your application code writes to the input. This prevents migration.
	@Input() selectedImages: IAttachment[] = [];
	readonly multiple = input<boolean>(false);
	readonly url = input<boolean>(false);
	// TODO: Skipped for migration because:
	//  Your application code writes to the input. This prevents migration.
	@Input() loading: boolean = true;
	readonly deleteAction = input<boolean>(true);

	readonly setImage = output<[] | any>();
	readonly setDeleteImage = output<number>();

	public term = new FormControl();
	public filter = {
		search: '',
		field: '',
		sort: '', // current Sorting Order
		page: 1, // current page number
		paginate: 48, // Display per page,
	};
	public totalItems: number = 0;

	private readonly params = signal<Params>({ ...this.filter });
	private readonly attachmentsQuery = injectAttachmentsQuery(() => this.params());
	attachment$: Observable<IAttachmentModel | undefined> = toObservable(this.attachmentsQuery.data);

	constructor() {
		this.attachment$.subscribe((attachment) => (this.totalItems = attachment?.total!));
		effect(() => {
			this.loading = this.attachmentsQuery.isFetching();
		});
		this.term.valueChanges.pipe(debounceTime(400), distinctUntilChanged()).subscribe((data: string) => {
			this.filter.search = data;
			this.getAttachments(this.filter);
		});
	}

	getAttachments(filter: Params, loader?: boolean) {
		if (!loader) this.renderer.addClass(this.document.body, 'loader-none');
		this.params.set({ ...filter });
	}

	onMediaChange(event: Event) {
		this.filter.sort = (<HTMLInputElement>event.target).value;
		this.getAttachments(this.filter);
	}

	onActionClicked(action: string, data: IAttachment) {
		if (action == 'delete') {
			// Delete has no backend yet — notify the parent to drop it locally.
			this.setDeleteImage.emit(data.id!);
		}
	}

	selectImage(event: Event, attachment: IAttachment, url: boolean) {
		if (this.multiple()) {
			const index = this.selectedImages.indexOf(attachment);
			if ((<HTMLInputElement>event.target).checked) {
				if (index == -1) this.selectedImages.push(attachment);
			} else {
				this.selectedImages = this.selectedImages.filter(
					(image) => image.id != parseInt((<HTMLInputElement>event.target).value),
				);
			}
		} else {
			this.selectedImages = <any>attachment;
		}

		if (url) {
			this.selectedImages = <any>attachment;
		}
		this.setImage.emit(this.selectedImages);
	}

	setPaginate(data: number) {
		this.filter.page = data;
		this.getAttachments(this.filter);
	}

	ngOnDestroy() {
		this.renderer.removeClass(this.document.body, 'loader-none');
	}
}
