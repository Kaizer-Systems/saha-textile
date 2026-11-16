import { ConfirmPopup, type ConfirmAsk } from './confirm-popup';
import { ReasonPopup, type ReasonAsk } from './reason-popup';

import type { NgbModal } from '@ng-bootstrap/ng-bootstrap';

/** Opens the reason popup; resolves with what `act` returned, or null when it was closed. */
export async function askReason(modals: NgbModal, ask: ReasonAsk): Promise<unknown | null> {
	const popup = modals.open(ReasonPopup, {
		centered: true,
		windowClass: 'theme-modal',
		ariaLabelledBy: 'reason_popup_title',
	});
	(popup.componentInstance as ReasonPopup).start(ask);
	return popup.result.catch(() => null);
}

/** Opens a yes-or-no question; resolves true on yes, false when cancelled or closed. */
export async function askConfirm(modals: NgbModal, ask: ConfirmAsk): Promise<boolean> {
	const popup = modals.open(ConfirmPopup, {
		centered: true,
		windowClass: 'theme-modal text-center',
		ariaLabelledBy: 'confirm_popup_title',
	});
	(popup.componentInstance as ConfirmPopup).start(ask);
	return popup.result.then(
		(answer) => answer === true,
		() => false,
	);
}

/** Two answers and a way out: true for yes, false for the `no` answer, null when cancelled. */
export async function askYesNo(modals: NgbModal, ask: ConfirmAsk & { no: string }): Promise<boolean | null> {
	const popup = modals.open(ConfirmPopup, {
		centered: true,
		windowClass: 'theme-modal text-center',
		ariaLabelledBy: 'confirm_popup_title',
	});
	(popup.componentInstance as ConfirmPopup).start(ask);
	return popup.result.then(
		(answer) => (answer === true ? true : answer === false ? false : null),
		() => null,
	);
}
