import { Component } from '@angular/core';

import { Toast } from '@damjantonkli/ngx-toastr';

/** What the toast's link says, already in the admin's language. */
export interface FmUndoToastPayload {
	action: string;
}

/**
 * The theme's toast with one link after the words (A37): “Moved 3 files to “Wedding 2026”. Undo”.
 * Same markup and fade as ngx-toastr's own toast; the link reports through `onAction`, so the page
 * runs Undo. The words are text, never HTML, so a file name cannot add markup.
 */
@Component({
	selector: '[fm-undo-toast]',
	host: {
		'[style.--animation-easing]': 'params.easing',
		'[style.--animation-duration]': 'params.easeTime + "ms"',
		'animate.enter': 'toast-in',
	},
	styles: [
		':host.toast-in{animation:toast-animation var(--animation-duration) var(--animation-easing)}:host.toast-out{animation:toast-animation var(--animation-duration) var(--animation-easing) reverse forwards}@keyframes toast-animation{0%{opacity:0}to{opacity:1}}',
	],
	template: `
		<div
			role="alert"
			[class]="options().messageClass"
		>
			{{ message() }}
			<a
				href="javascript:void(0)"
				data-action="undo"
				(click)="act($event)"
			>
				{{ options().payload?.action }}
			</a>
		</div>
	`,
})
export class FmUndoToast extends Toast<FmUndoToastPayload> {
	act(event: Event): void {
		event.stopPropagation();
		this.toastPackage.triggerAction();
		this.remove();
	}
}
