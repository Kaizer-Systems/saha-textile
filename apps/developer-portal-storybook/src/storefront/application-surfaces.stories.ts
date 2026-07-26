import { AfterViewInit, ChangeDetectorRef, Component, OnInit, ViewChild, inject } from '@angular/core';

import blogFixture from '../../../storefront/public/assets/data/blog.json';
import type { IBlog } from '../../../storefront/src/app/data-access/interfaces/blog.interface';
import { NotificationService } from '../../../storefront/src/app/data-access/services/notification.service';
import { Layout } from '../../../storefront/src/app/layout/layout';
import { Alert } from '../../../storefront/src/app/shared/ui/alert/alert';
import { BackToTop } from '../../../storefront/src/app/shared/ui/back-to-top/back-to-top';
import { BlogCarousel } from '../../../storefront/src/app/shared/ui/blog-carousel/blog-carousel';
import { Cookie } from '../../../storefront/src/app/shared/ui/cookie/cookie';
import { RecentPurchasePopup } from '../../../storefront/src/app/shared/ui/recent-purchase-popup/recent-purchase-popup';
import { StickyCart } from '../../../storefront/src/app/shared/ui/sticky-cart/sticky-cart';
import { StickyCompare } from '../../../storefront/src/app/shared/ui/sticky-compare/sticky-compare';

import { BehaviorSubject } from 'rxjs';

import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { simpleProduct } from '../fixtures/storefront-products';

const blogs = structuredClone(blogFixture.data.slice(0, 3)) as unknown as IBlog[];
const alertSubject = new BehaviorSubject({ type: 'success', message: 'Your configuration has been saved.' });

@Component({
	selector: 'storybook-storefront-alert-host',
	imports: [Alert],
	template: '<app-alert />',
})
class StorefrontAlertHost implements OnInit {
	private readonly notifications = inject(NotificationService);

	ngOnInit(): void {
		this.notifications.alertSubject.next(alertSubject.value);
	}
}

@Component({
	selector: 'storybook-recent-purchase-host',
	imports: [RecentPurchasePopup],
	template: '<app-recent-purchase-popup />',
})
class StorybookRecentPurchaseHost implements AfterViewInit {
	@ViewChild(RecentPurchasePopup, { static: true })
	private readonly popup!: RecentPurchasePopup;

	private readonly changeDetector = inject(ChangeDetectorRef);

	ngAfterViewInit(): void {
		this.popup.product = simpleProduct;
		this.popup.min = 3;
		this.popup.show = true;
		this.changeDetector.detectChanges();
	}
}

const meta = {
	title: 'Storefront/Layout/Application Surfaces',
	component: BlogCarousel,
	tags: ['autodocs'],
	decorators: [
		moduleMetadata({
			imports: [
				Layout,
				StorefrontAlertHost,
				Alert,
				BackToTop,
				BlogCarousel,
				Cookie,
				RecentPurchasePopup,
				StorybookRecentPurchaseHost,
				StickyCart,
				StickyCompare,
			],
			providers: [
				{
					provide: NotificationService,
					useValue: { alertSubject, notification: true },
				},
			],
		}),
	],
	parameters: {
		application: 'storefront',
		docs: {
			description: {
				component:
					'Application-level feedback, editorial, persistence, utility, and route-shell surfaces. Stateful chrome uses deterministic Storybook stores and HTTP responses.',
			},
		},
	},
	args: { blogs, title: 'From the journal' },
} satisfies Meta<BlogCarousel>;

export default meta;
type Story = StoryObj<BlogCarousel>;

export const EditorialRail: Story = {};

export const SuccessAlert: Story = {
	render: () => ({
		template: '<section class="storybookComponentStage"><storybook-storefront-alert-host /></section>',
	}),
};

export const CookieNotice: Story = {
	render: () => ({
		template: '<section class="storybookComponentStage"><app-cookie /></section>',
	}),
};

export const BackToTopControl: Story = {
	render: () => ({
		template: `
			<section class="storybookComponentStage storybookComponentStage--stack" style="min-height: 700px">
				<p class="storybookComponentStage__label">Scroll recovery control</p>
				<app-back-to-top />
			</section>
		`,
	}),
};

export const RecentPurchase: Story = {
	render: () => ({
		template: `
			<section class="storybookComponentStage storybookComponentStage--stack">
				<p class="storybookComponentStage__label">Forced-visible recent purchase signal</p>
				<storybook-recent-purchase-host />
			</section>
		`,
	}),
};

export const StickyCommerceUtilities: Story = {
	render: () => ({
		template: '<section class="storybookComponentStage"><app-sticky-cart /><app-sticky-compare /></section>',
	}),
};

export const CompleteApplicationChrome: Story = {
	render: () => ({ template: '<app-layout />' }),
};
