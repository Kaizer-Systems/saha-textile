import { AsyncPipe } from '@angular/common';
import {
	ChangeDetectorRef,
	Component,
	DOCUMENT,
	effect,
	Input,
	Renderer2,
	computed,
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
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Observable, debounceTime, distinctUntilChanged } from 'rxjs';

import { AuthStore } from '@core/state/auth.store';
import { IAttachment, IAttachmentModel } from '@data-access/interfaces/attachment.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { injectAttachmentsQuery } from '@data-access/queries/attachment.queries';
import { Loader } from '@layout/loader/loader';
import { DeleteModal, DeleteModal as DeleteModalComponent_1 } from '@shared/ui/modal/delete-modal/delete-modal';
import { MediaDetailsModal } from '@shared/ui/modal/media-details-modal/media-details-modal';

import { NoData } from '../no-data/no-data';
import { Pagination } from '../pagination/pagination';

@Component({
	selector: 'app-media-box',
	templateUrl: './media-box.html',
	styleUrls: ['./media-box.scss'],
	imports: [
		ReactiveFormsModule,
		Loader,
		MediaDetailsModal,
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
	private changeDetector = inject(ChangeDetectorRef);

	private queryClient = inject(QueryClient);
	private permissions = inject(AuthStore).permissions;
	readonly canEdit = computed(() => this.permissions().includes('attachment.edit'));
	readonly canDelete = computed(() => this.permissions().includes('attachment.destroy'));
	readonly detailsModal = viewChild<MediaDetailsModal>('detailsModal');
	readonly DeleteModal = viewChild<DeleteModal>('deleteModal');

	// TODO: Skipped for migration because:
	//  Your application code writes to the input. This prevents migration.
	/** The ticked pictures when choosing several; otherwise the one chosen. */
	@Input() selectedImages: IAttachment[] | IAttachment = [];
	readonly multiple = input<boolean>(false);
	readonly url = input<boolean>(false);
	// TODO: Skipped for migration because:
	//  Your application code writes to the input. This prevents migration.
	@Input() loading: boolean = true;
	readonly deleteAction = input<boolean>(true);

	readonly setImage = output<IAttachment[] | IAttachment>();
	readonly setDeleteImage = output<number | string>();

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
			// `loading` is a plain field the page may also bind, so writing it from an effect
			// does not re-render on its own. With cached library data the query never refetches,
			// and the picker sat on "Loading" until something else changed.
			this.loading = this.attachmentsQuery.isFetching();
			this.changeDetector.markForCheck();
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

	/** After the delete modal, which was opened with the attachment. */
	onActionClicked(action: string, data: unknown) {
		if (action == 'delete') {
			// Delete has no backend yet — notify the parent to drop it locally.
			this.setDeleteImage.emit((data as IAttachment).id!);
		}
	}

	selectImage(event: Event, attachment: IAttachment, url: boolean) {
		if (this.multiple()) {
			const chosen = Array.isArray(this.selectedImages) ? this.selectedImages : [];
			if ((<HTMLInputElement>event.target).checked) {
				if (chosen.indexOf(attachment) == -1) chosen.push(attachment);
				this.selectedImages = chosen;
			} else {
				this.selectedImages = chosen.filter(
					(image) => image.id != parseInt((<HTMLInputElement>event.target).value),
				);
			}
		} else {
			this.selectedImages = attachment;
		}

		if (url) {
			this.selectedImages = attachment;
		}
		this.setImage.emit(this.selectedImages);
	}

	editDetails(attachment: IAttachment) {
		void this.detailsModal()?.openModal(String(attachment.id));
	}

	/** After Edit details: the grid shows the saved file name. */
	refresh() {
		void this.queryClient.invalidateQueries({ queryKey: ['attachments'] });
	}

	setPaginate(data: number) {
		this.filter.page = data;
		this.getAttachments(this.filter);
	}

	ngOnDestroy() {
		this.renderer.removeClass(this.document.body, 'loader-none');
	}
}
