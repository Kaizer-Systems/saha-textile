import type { Meta, StoryObj } from '@storybook/angular';

import { IdleLockModal } from '../../../admin/src/app/shared/ui/idle-lock-modal/idle-lock-modal';
import { PinPad } from '../../../admin/src/app/shared/ui/pin-pad/pin-pad';

/**
 * Idle soft-lock composition (DEC-UI-REUSE).
 *
 * The live modal mounts on the admin app shell with DI (IdleLockService + AuthStore +
 * gateway). Storybook documents the PIN resume surface it reuses — `theme-modal` + PinPad —
 * without standing up the full session stack.
 */
const meta = {
	title: 'Admin/Auth/Idle Lock Modal',
	component: IdleLockModal,
	tags: ['autodocs'],
	parameters: {
		application: 'admin',
	},
	render: () => ({
		moduleMetadata: {
			imports: [PinPad],
		},
		template: `
			<section class="storybookComponentStage theme-modal text-center p-4">
				<h3 class="fw-semibold">Session locked</h3>
				<p class="text-content mb-3">Enter your PIN to continue.</p>
				<app-pin-pad [length]="6" [value]="'12'" />
			</section>
		`,
	}),
} satisfies Meta<IdleLockModal>;

export default meta;
type Story = StoryObj<IdleLockModal>;

/** PIN resume composition reused by the idle-lock overlay. */
export const PinResumeComposition: Story = {};
