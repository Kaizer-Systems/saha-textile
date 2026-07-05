import { isPlatformBrowser, AsyncPipe } from '@angular/common';
import { Component, DOCUMENT, inject, PLATFORM_ID, Renderer2, viewChild } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { toObservable } from '@angular/core/rxjs-interop';
import { computed } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { Select2Data, Select2Module } from 'ng-select2-component';
import { Observable } from 'rxjs';

import { injectUsersQuery } from '@data-access/queries/user.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Button } from '@shared/ui/button/button';
import { ConfirmationModal } from '@shared/ui/modal/confirmation-modal/confirmation-modal';
import { Table } from '@shared/ui/table/table';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { NumberDirective } from '@shared/directives/numbers-only.directive';
import { Params } from '@data-access/interfaces/core.interface';
import { ITransactionsData } from '@data-access/interfaces/point.interface';
import { PointService } from '@data-access/services/point.service';

@Component({
	selector: 'app-point',
	templateUrl: './point.html',
	styleUrls: ['./point.scss'],
	imports: [
		ReactiveFormsModule,
		PageWrapper,
		Select2Module,
		NumberDirective,
		HasPermissionDirective,
		Button,
		Table,
		ConfirmationModal,
		TranslateModule,
		AsyncPipe,
	],
})
export class Point {
	private document = inject<Document>(DOCUMENT);
	private renderer = inject(Renderer2);
	private pointService = inject(PointService);
	private formBuilder = inject(FormBuilder);

	private readonly usersQuery = injectUsersQuery(() => ({ role: 'consumer', status: 1 }));
	users$: Observable<Select2Data> = toObservable(
		computed(() => this.usersQuery.data()?.data.map((user) => ({ label: user.name, value: user.id })) ?? []),
	);

	readonly ConfirmationModal = viewChild<ConfirmationModal>('confirmationModal');

	public form: FormGroup;
	public balance: number = 0.0;
	public paginateInitialData: Params;
	public isBrowser: boolean;

	public tableConfig = {
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{ title: 'points', dataField: 'amount' },
			{ title: 'type', dataField: 'type_status' },
			{ title: 'remark', dataField: 'detail' },
			{ title: 'created_at', dataField: 'created_at', type: 'date' },
		],
		data: [] as ITransactionsData[],
		total: 0,
	};

	constructor() {
		const platformID = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformID);
		this.form = this.formBuilder.group({
			consumer_id: new FormControl('', [Validators.required]),
			balance: new FormControl('', [Validators.required]),
		});

		this.form.controls['consumer_id'].valueChanges.subscribe((value) => {
			if (value) {
				this.paginateInitialData['consumer_id'] = value;
				this.loadTransactions(this.paginateInitialData);
				this.renderer.addClass(this.document.body, 'loader-none');
			} else {
				this.balance = 0;
				this.tableConfig.data = [];
				this.tableConfig.total = 0;
				this.form.controls['balance'].reset();
			}
		});
	}

	private loadTransactions(params: Params) {
		this.pointService.getUserTransaction(params).subscribe((point) => {
			const transactions = point?.transactions?.data?.filter((element: ITransactionsData) => {
				element.type_status = element.type
					? `<div class="status-${element.type}"><span>${element.type.replace(/_/g, ' ')}</span></div>`
					: '-';
				return element;
			});
			this.balance = point ? point.balance : 0.0;
			this.tableConfig.data = point ? transactions : [];
			this.tableConfig.total = point ? point.transactions.total : 0;
		});
	}

	onTableChange(data?: Params) {
		this.paginateInitialData = data!;
		let vendor_id = this.form.controls['consumer_id']?.value;
		this.paginateInitialData['consumer_id'] = vendor_id;
		if (vendor_id) {
			this.loadTransactions(this.paginateInitialData);
		}
	}

	submit(_type: string) {
		this.form.markAllAsTouched();

		if (this.form.valid) {
			// Credit/debit have no backend yet — just reset the input.
			this.form.controls['balance'].reset();
		}
	}

	ngOnDestroy() {
		this.renderer.removeClass(this.document.body, 'loader-none');
	}
}
