import { AfterViewInit, Component, viewChild } from '@angular/core';

import { of } from 'rxjs';

import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { StorefrontAuthGateway } from '../../../storefront/src/app/core/auth/auth-gateway';
import { ProviderSdkLoader } from '../../../storefront/src/app/core/auth/provider-sdk.loader';
import { runtimeConfig } from '../../../storefront/src/app/core/config/runtime-config';
import { SocialSignIn } from '../../../storefront/src/app/shared/ui/social-sign-in/social-sign-in';

/**
 * Isolated SocialSignIn specimen. Real component; provider SDKs and the auth gateway
 * are replaced so Storybook never loads Google/Meta scripts or hits the API.
 */
const STATE = {
	stateId: 'oas_storybook',
	nonce: null as string | null,
	expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
};

const gatewayBoundary = {
	startOAuth: () => of(STATE),
	verifyGoogle: () => of({ outcome: 'signup_required', user: null, session: null, pendingSignup: null }),
	verifyFacebook: () => of({ outcome: 'signup_required', user: null, session: null, pendingSignup: null }),
};

const facebookSdk = {
	init: () => undefined,
	login: (callback: (response: { authResponse: null; status: string }) => void) => {
		callback({ authResponse: null, status: 'unknown' });
	},
};

const sdkBoundary = {
	loadGoogle: async () => null,
	// The component configures GIS through the loader rather than on the API directly, so that
	// the service owning that global knows it has been configured — `revokeGoogleGrant` is
	// refused before the first `initialize()`. Storybook never loads GIS, so this answers the
	// same way `loadGoogle` does.
	initializeGoogle: async () => null,
	revokeGoogleGrant: async () => false,
	loadFacebook: async () => facebookSdk,
};

function applySocialConfig(input: { googleClientId: string; facebookAppId: string }): void {
	runtimeConfig.googleClientId = input.googleClientId;
	runtimeConfig.facebookAppId = input.facebookAppId;
}

@Component({
	selector: 'storybook-social-status-host',
	imports: [SocialSignIn],
	template: '<app-social-sign-in />',
})
class SocialStatusHost implements AfterViewInit {
	private readonly social = viewChild.required(SocialSignIn);

	ngAfterViewInit(): void {
		queueMicrotask(() => this.social().status.set('social_unavailable'));
	}
}

const meta = {
	title: 'Storefront/Auth/Social Sign In',
	component: SocialSignIn,
	decorators: [
		moduleMetadata({
			imports: [SocialSignIn, SocialStatusHost],
			providers: [
				{ provide: StorefrontAuthGateway, useValue: gatewayBoundary },
				{ provide: ProviderSdkLoader, useValue: sdkBoundary },
			],
		}),
	],
	parameters: {
		application: 'storefront',
		docs: {
			description: {
				component:
					'The live Google and Facebook sign-in buttons. Unconfigured providers render nothing. Storybook never loads the provider SDKs.',
			},
		},
	},
} satisfies Meta<SocialSignIn>;

export default meta;
type Story = StoryObj<SocialSignIn>;

export const Unconfigured: Story = {
	render: () => {
		applySocialConfig({ googleClientId: '', facebookAppId: '' });
		return {
			template: `
				<section class="storybookComponentStage">
					<app-social-sign-in />
				</section>
			`,
		};
	},
};

export const FacebookConfigured: Story = {
	render: () => {
		applySocialConfig({ googleClientId: '', facebookAppId: 'storybook-facebook-app' });
		return {
			template: `
				<section class="storybookComponentStage">
					<app-social-sign-in />
				</section>
			`,
		};
	},
};

export const ConnectMode: Story = {
	render: () => {
		applySocialConfig({ googleClientId: '', facebookAppId: 'storybook-facebook-app' });
		return {
			template: `
				<section class="storybookComponentStage">
					<app-social-sign-in mode="connect" />
				</section>
			`,
		};
	},
};

export const StatusLine: Story = {
	render: () => {
		applySocialConfig({ googleClientId: '', facebookAppId: 'storybook-facebook-app' });
		return {
			template: `
				<section class="storybookComponentStage">
					<storybook-social-status-host />
				</section>
			`,
		};
	},
};
