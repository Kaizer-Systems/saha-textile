import { Component, computed } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { injectBrandQuery } from '@data-access/queries/brand.queries';

/** Footer order and icon of each profile the Brand Kit can hold (YouTube comes from the YouTube tab). */
const NETWORKS = [
	{ key: 'facebook', label: 'Facebook', icon: 'ri-facebook-fill' },
	{ key: 'x', label: 'X', icon: 'ri-twitter-fill' },
	{ key: 'instagram', label: 'Instagram', icon: 'ri-instagram-fill' },
	{ key: 'pinterest', label: 'Pinterest', icon: 'ri-pinterest-fill' },
	{ key: 'youtube', label: 'YouTube', icon: 'ri-youtube-fill' },
	{ key: 'linkedin', label: 'LinkedIn', icon: 'ri-linkedin-fill' },
	{ key: 'threads', label: 'Threads', icon: 'ri-threads-fill' },
] as const;

/**
 * Footer "Stay connected": the shop's profiles from the Brand Kit (owner, 2026-11-10). They used to
 * come from the theme file; an empty profile hides its icon, and with none the block is hidden.
 */
@Component({
	selector: 'app-footer-social-links',
	templateUrl: './social-links.html',
	styleUrls: ['./social-links.scss'],
	imports: [TranslocoModule],
})
export class SocialLinks {
	private readonly brand = injectBrandQuery();

	readonly profiles = computed(() => {
		const socials = this.brand.data()?.socials ?? {};
		return NETWORKS.filter((network) => socials[network.key]).map((network) => ({
			...network,
			href: socials[network.key] as string,
		}));
	});
}
