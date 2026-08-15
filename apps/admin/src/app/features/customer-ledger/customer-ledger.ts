import { isPlatformBrowser, AsyncPipe } from '@angular/common';
import { Component, DOCUMENT, computed, inject, PLATFORM_ID, Renderer2, signal, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { Select2Data, Select2Module } from 'ng-select2-component';
import { Observable } from 'rxjs';

import { SettingStore } from '@core/state/setting.store';
import { Params } from '@data-access/interfaces/core.interface';
import { IValues } from '@data-access/interfaces/setting.interface';
import { ITableConfig } from '@data-access/interfaces/table.interface';
import {
	injectAdminCustomersQuery,
	injectAdminCustomerOrdersQuery,
} from '@data-access/queries/admin-customers.queries';
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
	private formBuilder = inject(FormBuilder);

	private readonly customersQuery = injectAdminCustomersQuery(() => ({ page: 1, pageSize: 100 }));
	private readonly customerId = signal<string | null>(null);
	private readonly orderParams = signal<{
		page: number;
		pageSize: number;
		q?: string;
		startDate?: Date;
		endDate?: Date;
	}>({
		page: 1,
		pageSize: 24,
	});
	private readonly ordersQuery = injectAdminCustomerOrdersQuery(
		() => this.customerId(),
		() => this.orderParams(),
	);

	customers$: Observable<Select2Data> = toObservable(
		computed(
			() =>
				this.customersQuery.data()?.items.map((customer) => ({
					label: customer.displayName ?? customer.email ?? customer.id,
					value: customer.id,
				})) ?? [],
		),
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
			{ title: 'order_number', dataField: 'orderNumber' },
			{ title: 'amount', dataField: 'totalAmount', type: 'price' },
			{ title: 'status', dataField: 'status' },
			{ title: 'created_at', dataField: 'createdAt', type: 'date' },
		],
		data: [],
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
				this.customerId.set(value);
				this.renderer.addClass(this.document.body, 'loader-none');
			} else {
				this.customerId.set(null);
				this.balance = 0;
				this.tableConfig.data = [];
				this.tableConfig.total = 0;
				this.form.controls['balance'].reset();
			}
		});

		// Watch orders query changes to update table
		toObservable(
			computed(() => {
				const data = this.ordersQuery.data();
				if (data) {
					this.tableConfig.data = data.items.map((order) => ({
						...order,
						no: order.id,
					}));
					this.tableConfig.total = data.meta.total;
				}
			}),
		).subscribe();
	}

	onTableChange(data?: Params) {
		if (!data) return;
		const page = data['page'] ? Number(data['page']) : 1;
		const pageSize = data['paginate'] ? Number(data['paginate']) : data['pageSize'] ? Number(data['pageSize']) : 24;
		const q = data['search'] ? String(data['search']) : undefined;
		const startRaw = data['start_date'] ?? data['startDate'];
		const endRaw = data['end_date'] ?? data['endDate'];
		const startDate = startRaw ? new Date(String(startRaw)) : undefined;
		const endDate = endRaw ? new Date(String(endRaw)) : undefined;

		this.orderParams.set({ page, pageSize, q, startDate, endDate });
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
