import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import { VENDOR_NAMES, type Vendor } from '@saha-textile/release-console-contracts';

/**
 * Where each provider's logo comes from. Nothing is stored: the browser loads it from Iconify's
 * public icon service when the screen opens. One-colour logos get a colour that shows on the dark
 * console; a provider Iconify lacks shows its own site icon, through Google's favicon service.
 */
export const VENDOR_LOGOS: Record<Vendor, { icon?: string; color?: string; domain: string }> = {
	github: { icon: 'simple-icons/github', color: '#e6edf3', domain: 'github.com' },
	gitlab: { icon: 'logos/gitlab-icon', domain: 'gitlab.com' },
	bitbucket: { icon: 'logos/bitbucket', domain: 'bitbucket.org' },
	'azure-repos': { icon: 'simple-icons/azuredevops', color: '#2f8fe8', domain: 'dev.azure.com' },
	digitalocean: { icon: 'logos/digital-ocean-icon', domain: 'digitalocean.com' },
	aws: { icon: 'simple-icons/amazonwebservices', color: '#ff9900', domain: 'aws.amazon.com' },
	gcp: { icon: 'logos/google-cloud', domain: 'cloud.google.com' },
	azure: { icon: 'logos/microsoft-azure', domain: 'azure.microsoft.com' },
	cloudflare: { icon: 'logos/cloudflare-icon', domain: 'cloudflare.com' },
	cloudfront: { icon: 'logos/aws-cloudfront', domain: 'aws.amazon.com' },
	fastly: { icon: 'simple-icons/fastly', color: '#ff282d', domain: 'fastly.com' },
	infisical: { domain: 'infisical.com' },
	'infisical-self-hosted': { domain: 'infisical.com' },
	'aws-secrets-manager': { icon: 'logos/aws-secrets-manager', domain: 'aws.amazon.com' },
	'gcp-secret-manager': { icon: 'logos/google-cloud', domain: 'cloud.google.com' },
	'azure-key-vault': { icon: 'logos/microsoft-azure', domain: 'azure.microsoft.com' },
	doppler: { domain: 'doppler.com' },
	vault: { icon: 'simple-icons/vault', color: '#ffd814', domain: 'vaultproject.io' },
	'github-secrets': { icon: 'simple-icons/githubactions', color: '#2088ff', domain: 'github.com' },
	'server-files': { icon: 'tabler/server-2', color: '#5ed6ff', domain: '' },
};

/** An Iconify image address: `set/name`, its height, and a colour for one-colour icons. */
export function iconUrl(icon: string, height: number, color?: string): string {
	return `https://api.iconify.design/${icon}.svg?height=${height}${color ? `&color=${encodeURIComponent(color)}` : ''}`;
}

/** The provider's own site icon, for providers Iconify does not carry. */
export const siteIconUrl = (domain: string): string => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

/**
 * A provider's logo, loaded live, followed by its name (unless `named` is false, where the name
 * already shows beside it); the logo never wraps away from the name. If both logo sources fail
 * (offline), the name stands alone.
 */
@Component({
	selector: 'rc-vendor-logo',
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { class: 'rc-vlogo', '[class.bare]': '!named()' },
	template: `
		@if (src(); as s) {
			<img
				[src]="s"
				[attr.height]="size()"
				alt=""
				referrerpolicy="no-referrer"
				(error)="next()"
			/>
		}
		@if (named()) {
			<span>{{ name() }}</span>
		}
	`,
})
export class VendorLogo {
	readonly vendor = input.required<Vendor>();
	readonly size = input(18);
	readonly named = input(true);
	protected readonly name = computed(() => VENDOR_NAMES[this.vendor()]);
	private readonly attempt = signal(0);
	protected readonly src = computed(() => {
		const l = VENDOR_LOGOS[this.vendor()];
		const sources = [
			l.icon ? iconUrl(l.icon, this.size(), l.color) : null,
			// Every vendor has a domain; not every one has a logo icon.
			siteIconUrl(l.domain),
		].filter((x): x is string => !!x);
		return sources[this.attempt()] ?? null;
	});
	protected next(): void {
		this.attempt.update((n) => n + 1);
	}
}

/** The icon of each Add-a-project step, in step order. */
export const STEP_ICONS = [
	'tabler/folders',
	'tabler/brand-git',
	'tabler/stack-2',
	'tabler/cloud',
	'tabler/world',
	'tabler/key',
	'tabler/list-details',
	'tabler/circle-check',
];
