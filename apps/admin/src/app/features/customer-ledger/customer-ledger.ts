import { isPlatformBrowser, AsyncPipe } from '@angular/common';
import { Component, DOCUMENT, computed, inject, PLATFORM_ID, Renderer2, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { Select2Data, Select2Module } from 'ng-select2-component';
import { Observable } from 'rxjs';

import { SettingStore } from '@core/state/setting.store';
import { Params } from '@data-access/interfaces/core.interface';
import { IValues } from '@data-access/interfaces/setting.interface';
import { ITableConfig } from '@data-access/interfaces/table.interface';
import { ITransactionsData } from '@data-access/interfaces/wallet.interface';
import { injectUsersQuery } from '@data-access/queries/user.queries';
import { CustomerLedgerService } from '@data-access/services/customer-ledger.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { NumberDirective } from '@shared/directives/numbers-only.directive';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { Button } from '@shared/ui/button/button';
import { ConfirmationModal } from '@shared/ui/modal/confirmation-modal/confirmation-modal';
import { Table } from '@shared/ui/table/table';

@Component({
	selector: 'app-customer-ledger',
	templateUrl: './customer-ledger.html',
	styleUrls: ['./customer-ledger.scss'],
	providers: [CurrencySymbolPipe],
	imports: [
		ReactiveFormsModule,
		PageWrapper,
		Select2Module,
		NumberDirective,
		HasPermissionDirective,
		Button,
		Table,
		ConfirmationModal,
		TranslocoModule,
		CurrencySymbolPipe,
		AsyncPipe,
	],
})
export class CustomerLedger {
	private document = inject<Document>(DOCUMENT);
	private renderer = inject(Renderer2);
	private customerLedgerService = inject(CustomerLedgerService);
	private formBuilder = inject(FormBuilder);

	private readonly usersQuery = injectUsersQuery(() => ({ role: 'consumer', status: 1 }));
	users$: Observable<Select2Data> = toObservable(
		computed(() => this.usersQuery.data()?.data.map((user) => ({ label: user.name, value: user.id })) ?? []),
	);
	setting$: Observable<IValues | null> = toObservable(inject(SettingStore).setting);

	readonly ConfirmationModal = viewChild<ConfirmationModal>('confirmationModal');

	public form: FormGroup;
	public balance: number;
	public paginateInitialData: Params;
	public isBrowser: boolean;

	public tableConfig: ITableConfig = {
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{ title: 'amount', dataField: 'amount', type: 'price' },
			{ title: 'type', dataField: 'type_status' },
			{ title: 'remark', dataField: 'detail' },
			{ title: 'created_at', dataField: 'created_at', type: 'date' },
		],
		data: [] as ITransactionsData[],
		total: 0,
	};

	constructor() {
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);

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
		this.customerLedgerService.getUserTransaction(params).subscribe((wallet) => {
			const transactions = wallet?.transactions?.data?.filter((element: ITransactionsData) => {
				element.type_status = element.type
					? `<div class="status-${element.type}"><span>${element.type.replace(/_/g, ' ')}</span></div>`
					: '-';
				return element;
			});
			this.balance = wallet ? wallet.balance : 0;
			this.tableConfig.data = wallet ? transactions : [];
			this.tableConfig.total = wallet ? wallet.transactions.total : 0;
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
