import { Component, OnInit, inject } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';

import type { IAttachment } from '../../../admin/src/app/data-access/interfaces/attachment.interface';
import type { IBaseRow, ITableConfig } from '../../../admin/src/app/data-access/interfaces/table.interface';
import { NotificationService } from '../../../admin/src/app/data-access/services/notification.service';
import { Alert } from '../../../admin/src/app/shared/ui/alert/alert';
import { ImageUpload } from '../../../admin/src/app/shared/ui/image-upload/image-upload';
import { Link } from '../../../admin/src/app/shared/ui/link/link';
import { MediaBox } from '../../../admin/src/app/shared/ui/media-box/media-box';
import { Table } from '../../../admin/src/app/shared/ui/table/table';

import { BehaviorSubject } from 'rxjs';

import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

const attachment: IAttachment = {
	id: 41,
	collection_name: 'catalogue',
	name: 'Handloom silk',
	file_name: 'handloom-silk.jpg',
	mime_type: 'image/jpeg',
	disk: 'public',
	conversions_disk: 'public',
	size: '128 KB',
	original_url: '/admin-assets/assets/images/product.png',
	created_by_id: 1,
};

interface StorybookProductRow extends IBaseRow {
	name: string;
	sku: string;
	status: string;
}

const tableConfig: ITableConfig<StorybookProductRow> = {
	columns: [
		{ title: 'Product', dataField: 'name', sortable: true },
		{ title: 'SKU', dataField: 'sku', sortable: true },
		{ title: 'Status', dataField: 'status' },
	],
	rowActions: [
		{ label: 'Edit', actionToPerform: 'edit', icon: 'ri-pencil-line' },
		{ label: 'Delete', actionToPerform: 'delete', icon: 'ri-delete-bin-line' },
	],
	data: [
		{ id: 1, name: 'Heritage Silk Saree', sku: 'ST-HS-001', status: 'Published' },
		{ id: 2, name: 'Handloom Cotton Saree', sku: 'ST-HC-014', status: 'Draft' },
		{ id: 3, name: 'Festive Blouse Piece', sku: 'ST-BP-006', status: 'Published' },
	],
	total: 3,
};

const linkForm = new FormGroup({
	link_type: new FormControl('collection'),
	link: new FormControl('sarees'),
	product_ids: new FormControl<number[]>([]),
});

const alertSubject = new BehaviorSubject({ type: 'success', message: 'The catalogue surface is ready.' });

@Component({
	selector: 'storybook-admin-alert-host',
	imports: [Alert],
	template: '<app-alert />',
})
class AdminAlertHost implements OnInit {
	private readonly notifications = inject(NotificationService);

	ngOnInit(): void {
		this.notifications.alertSubject.next(alertSubject.value);
	}
}

const meta = {
	title: 'Admin/Data & Media/Data Surfaces',
	component: Table,
	tags: ['autodocs'],
	decorators: [
		moduleMetadata({
			imports: [AdminAlertHost, Alert, ImageUpload, Link, MediaBox, Table],
			providers: [
				{
					provide: NotificationService,
					useValue: {
						alertSubject,
						notification: true,
					},
				},
			],
		}),
	],
	parameters: {
		application: 'admin',
		docs: {
			description: {
				component:
					'Admin tables, link controls, media selection, image upload, and alert feedback mounted with local fixtures and deterministic service boundaries.',
			},
		},
	},
	args: {
		tableConfig,
		hasCheckbox: true,
		hasDuplicate: true,
		topbar: true,
		pagination: true,
		loading: false,
	},
} satisfies Meta<Table>;

export default meta;
type Story = StoryObj<Table>;

export const ConfigurableTable: Story = {};

export const ImageUploadField: Story = {
	render: () => ({
		props: { attachment },
		template:
			'<section class="storybookComponentStage"><app-image-upload [image]="attachment" helpText="Use a square catalogue image." /></section>',
	}),
};

export const MediaLibrary: Story = {
	render: () => ({
		props: { attachment },
		template:
			'<section class="storybookComponentStage storybookComponentStage--wide"><app-media-box [selectedImages]="[attachment]" [loading]="false" [multiple]="true" /></section>',
	}),
};

export const LinkBuilder: Story = {
	render: () => ({
		props: {
			linkForm,
			products: [
				{ label: 'Heritage Silk Saree', value: 'heritage-silk-saree' },
				{ label: 'Handloom Cotton Saree', value: 'handloom-cotton-saree' },
			],
		},
		template:
			'<section class="storybookComponentStage"><app-link [linkForm]="linkForm" [products]="products" /></section>',
	}),
};

export const SuccessAlert: Story = {
	render: () => ({ template: '<section class="storybookComponentStage"><storybook-admin-alert-host /></section>' }),
};
