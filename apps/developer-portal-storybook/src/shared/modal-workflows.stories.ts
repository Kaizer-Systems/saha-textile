import { AfterViewInit, Component, viewChild } from '@angular/core';

import orderFixture from '../../../storefront/public/assets/data/order.json';
import refundFixture from '../../../storefront/public/assets/data/refund.json';
import type { IOrder } from '../../../storefront/src/app/data-access/interfaces/order.interface';
import type { IProduct } from '../../../storefront/src/app/data-access/interfaces/product.interface';
import { NotificationService as StorefrontNotificationService } from '../../../storefront/src/app/data-access/services/notification.service';
import { AddressModal } from '../../../storefront/src/app/shared/ui/modal/address-modal/address-modal';
import { DealsModal } from '../../../storefront/src/app/shared/ui/modal/deals-modal/deals-modal';
import { DeleteModal } from '../../../storefront/src/app/shared/ui/modal/delete-modal/delete-modal';
import { EditProfileModal } from '../../../storefront/src/app/shared/ui/modal/edit-profile-modal/edit-profile-modal';
import { PayModal } from '../../../storefront/src/app/shared/ui/modal/pay-modal/pay-modal';
import { RefundModal } from '../../../storefront/src/app/shared/ui/modal/refund-modal/refund-modal';
import type { IRefund } from '../../../admin/src/app/data-access/interfaces/refund.interface';
import { NotificationService as AdminNotificationService } from '../../../admin/src/app/data-access/services/notification.service';
import { ImportCsvModal } from '../../../admin/src/app/shared/ui/modal/import-csv-modal/import-csv-modal';
import { PayoutModal } from '../../../admin/src/app/shared/ui/modal/payout-modal/payout-modal';

import { Subject } from 'rxjs';

import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { simpleProduct } from '../fixtures/storefront-products';

const order = structuredClone(orderFixture.data[0]) as unknown as IOrder;
const payout = structuredClone(refundFixture.data[0]) as unknown as IRefund;
const notificationBoundary = {
	alertSubject: new Subject(),
	notification: false,
	showSuccess: () => undefined,
	showError: () => undefined,
};

@Component({
	selector: 'storybook-address-modal-host',
	imports: [AddressModal],
	template: '<address-modal #modal />',
})
class AddressModalHost implements AfterViewInit {
	private readonly modal = viewChild.required<AddressModal>('modal');
	ngAfterViewInit(): void {
		queueMicrotask(() => void this.modal().openModal());
	}
}

@Component({
	selector: 'storybook-deals-modal-host',
	imports: [DealsModal],
	template: '<app-deals-modal #modal [products]="products" />',
})
class DealsModalHost implements AfterViewInit {
	readonly products: IProduct[] = [simpleProduct];
	private readonly modal = viewChild.required<DealsModal>('modal');
	ngAfterViewInit(): void {
		queueMicrotask(() => void this.modal().openModal());
	}
}

@Component({
	selector: 'storybook-delete-modal-host',
	imports: [DeleteModal],
	template: '<app-delete-modal #modal />',
})
class DeleteModalHost implements AfterViewInit {
	private readonly modal = viewChild.required<DeleteModal>('modal');
	ngAfterViewInit(): void {
		queueMicrotask(() => void this.modal().openModal('delete', { id: 901, name: 'Heritage Silk Saree' }));
	}
}

@Component({
	selector: 'storybook-profile-modal-host',
	imports: [EditProfileModal],
	template: '<app-edit-profile-modal #modal />',
})
class ProfileModalHost implements AfterViewInit {
	private readonly modal = viewChild.required<EditProfileModal>('modal');
	ngAfterViewInit(): void {
		queueMicrotask(() => void this.modal().openModal());
	}
}

@Component({
	selector: 'storybook-pay-modal-host',
	imports: [PayModal],
	template: '<app-pay-modal #modal />',
})
class PayModalHost implements AfterViewInit {
	private readonly modal = viewChild.required<PayModal>('modal');
	ngAfterViewInit(): void {
		queueMicrotask(() => void this.modal().openModal(order));
	}
}

@Component({
	selector: 'storybook-refund-modal-host',
	imports: [RefundModal],
	template: '<app-refund-modal #modal />',
})
class RefundModalHost implements AfterViewInit {
	private readonly modal = viewChild.required<RefundModal>('modal');
	ngAfterViewInit(): void {
		queueMicrotask(() => void this.modal().openModal(simpleProduct));
	}
}

@Component({
	selector: 'storybook-import-modal-host',
	imports: [ImportCsvModal],
	template: '<app-import-csv-modal #modal module="product" />',
})
class ImportModalHost implements AfterViewInit {
	private readonly modal = viewChild.required<ImportCsvModal>('modal');
	ngAfterViewInit(): void {
		queueMicrotask(() => void this.modal().openModal());
	}
}

@Component({
	selector: 'storybook-payout-modal-host',
	imports: [PayoutModal],
	template: '<app-payout-modal #modal label="Approve payout" [action]="true" />',
})
class PayoutModalHost implements AfterViewInit {
	private readonly modal = viewChild.required<PayoutModal>('modal');
	ngAfterViewInit(): void {
		queueMicrotask(() => void this.modal().openModal(payout));
	}
}

const meta = {
	title: 'Shared/Workflows/Modal Workflows',
	component: DeleteModal,
	decorators: [
		moduleMetadata({
			imports: [
				AddressModalHost,
				DealsModalHost,
				DeleteModalHost,
				ProfileModalHost,
				PayModalHost,
				RefundModalHost,
				ImportModalHost,
				PayoutModalHost,
			],
			providers: [
				{ provide: StorefrontNotificationService, useValue: notificationBoundary },
				{ provide: AdminNotificationService, useValue: notificationBoundary },
			],
		}),
	],
	parameters: {
		application: 'shared',
		docs: { disable: true },
	},
} satisfies Meta<DeleteModal>;

export default meta;
type Story = StoryObj<DeleteModal>;

export const AddressEditor: Story = { render: () => ({ template: '<storybook-address-modal-host />' }) };
export const ProductDeals: Story = { render: () => ({ template: '<storybook-deals-modal-host />' }) };
export const DeleteConfirmation: Story = { render: () => ({ template: '<storybook-delete-modal-host />' }) };
export const ProfileEditor: Story = { render: () => ({ template: '<storybook-profile-modal-host />' }) };
export const OrderPayment: Story = { render: () => ({ template: '<storybook-pay-modal-host />' }) };
export const ProductRefund: Story = { render: () => ({ template: '<storybook-refund-modal-host />' }) };
export const CsvImport: Story = { render: () => ({ template: '<storybook-import-modal-host />' }) };
export const PayoutApproval: Story = { render: () => ({ template: '<storybook-payout-modal-host />' }) };
