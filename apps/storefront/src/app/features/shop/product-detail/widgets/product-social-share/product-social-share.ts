import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { IProduct } from '@data-access/interfaces/product.interface';
import { ISiteConfig } from '@data-access/interfaces/site-config.interface';

import { environment } from '../../../../../../../public/environments/environment';

@Component({
	selector: 'app-product-social-share',
	templateUrl: './product-social-share.html',
	styleUrls: ['./product-social-share.scss'],
	imports: [TranslocoModule],
})
export class ProductSocialShare {
	private platformId = inject<Object>(PLATFORM_ID);

	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly product = input<IProduct>();
	readonly option = input<ISiteConfig | null>();

	url: string = environment.baseURL;

	shareOnFacebook(slug: string) {
		if (isPlatformBrowser(this.platformId)) {
			const facebookShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(this.url + '/product/' + slug)}`;
			window.open(facebookShareUrl, '_blank');
		}
	}

	shareOnTwitter(slug: string) {
		if (isPlatformBrowser(this.platformId)) {
			const twitterShareUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(this.url + '/product/' + slug)}`;
			window.open(twitterShareUrl, '_blank');
		}
	}

	shareOnLinkedIn(slug: string) {
		if (isPlatformBrowser(this.platformId)) {
			const linkedInShareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(this.url + '/product/' + slug)}`;
			window.open(linkedInShareUrl, '_blank');
		}
	}

	shareOnWhatsApp(slug: string) {
		if (isPlatformBrowser(this.platformId)) {
			const whatsappShareUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(this.url + '/product/' + slug)}`;
			window.open(whatsappShareUrl, '_blank');
		}
	}

	shareViaEmail(slug: string) {
		if (isPlatformBrowser(this.platformId)) {
			const subject = 'Check out this awesome product!';
			const body = `I thought you might be interested in this product: ${this.url + '/product/' + slug}`;
			const emailShareUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
			window.location.href = emailShareUrl; // Use location.href to open the default email client
		}
	}
}
