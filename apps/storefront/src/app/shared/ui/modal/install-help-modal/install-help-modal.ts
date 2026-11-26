import { Component, inject } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { Button } from '../../button/button';

export type InstallGuide = 'ios' | 'mac' | 'other';

/** Picks the steps for browsers that cannot show an install prompt of their own. */
export function installGuide(device: Pick<Navigator, 'maxTouchPoints' | 'userAgent'>): InstallGuide {
	const agent = device.userAgent;
	const mac = agent.includes('Macintosh');
	// iPadOS reports itself as a Mac, so touch is what tells them apart.
	if (/iPhone|iPad|iPod/.test(agent) || (mac && device.maxTouchPoints > 1)) return 'ios';
	if (mac && agent.includes('Safari') && !/Chrome|Chromium|Edg|OPR|Firefox/.test(agent)) return 'mac';
	return 'other';
}

/** The how-to popup. Its wording holds the steps' bold text and icon, and comes from our own i18n files. */
@Component({
	selector: 'app-install-help-modal',
	templateUrl: './install-help-modal.html',
	imports: [Button, TranslocoModule],
})
export class InstallHelpModal {
	readonly modal = inject(NgbActiveModal);
	readonly steps = [1, 2, 3].map((step) => `install_${installGuide(navigator)}_step_${step}`);
}
