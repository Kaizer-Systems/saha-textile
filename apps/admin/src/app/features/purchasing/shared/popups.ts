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
