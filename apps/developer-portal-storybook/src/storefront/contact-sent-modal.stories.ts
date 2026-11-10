import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { ContactSentModal } from '../../../storefront/src/app/shared/ui/modal/contact-sent-modal/contact-sent-modal';

/**
 * The "thank you" popup after a Contact Us message. Shown here inside the theme's modal frame;
 * the active-modal handle is a stand-in, so closing it does nothing in Storybook.
 */
const meta = {
	title: 'Storefront/Popups/Contact Sent',
	component: ContactSentModal,
	tags: ['autodocs'],
	decorators: [
		moduleMetadata({
			providers: [{ provide: NgbActiveModal, useValue: { close: () => undefined, dismiss: () => undefined } }],
		}),
	],
	parameters: { application: 'storefront' },
	render: () => ({
		template: `<section class="storybookComponentStage theme-modal" style="max-width: 520px"><div class="modal-content"><app-contact-sent-modal /></div></section>`,
	}),
} satisfies Meta<ContactSentModal>;

export default meta;
type Story = StoryObj<ContactSentModal>;

/** As a shopper sees it after sending a message. */
export const AfterSending: Story = {};
