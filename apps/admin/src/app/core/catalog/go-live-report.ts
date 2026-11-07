import type { GoLiveGap, GoLiveResult } from '@saha-textile/contracts';

const LANGUAGE_NAMES: Readonly<Record<string, string>> = { en: 'English', fr: 'Français' };
const SHOWN_IN_TOAST = 3;

type Translate = (key: string) => string;

function gapKey(field: string): string {
	return `gap_${field.split(':')[0]}`;
}

/** Each gap in words, with its language. */
export function goLiveLabels(gaps: readonly GoLiveGap[], translate: Translate): string[] {
	return gaps.map(({ field, locale }) => {
		const detail = field.split(':').slice(1).join(' ');
		const label = [translate(gapKey(field)), detail].filter(Boolean).join(' ');
		return locale ? `${LANGUAGE_NAMES[locale] ?? locale}: ${label}` : label;
	});
}

interface Toasts {
	showSuccess(message: string): void;
	showError(message: string): void;
}

/** One toast for the product form and the product list. */
export function goLiveToast(result: GoLiveResult, toasts: Toasts, translate: Translate): void {
	if (result.live) {
		toasts.showSuccess(translate('go_live_done'));
		return;
	}
	const labels = goLiveLabels(result.gaps, translate);
	const more = labels.length - SHOWN_IN_TOAST;
	const shown = labels.slice(0, SHOWN_IN_TOAST).join(', ');
	toasts.showError(`${translate('go_live_blocked')} ${shown}${more > 0 ? ` (+${more})` : ''}`);
}
