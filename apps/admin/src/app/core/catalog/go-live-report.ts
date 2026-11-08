import { HttpErrorResponse } from '@angular/common/http';

import type { GoLiveGap, GoLiveResult } from '@saha-textile/contracts';

const LANGUAGE_NAMES: Readonly<Record<string, string>> = { en: 'English', bn: 'বাংলা' };
const SHOWN_IN_TOAST = 3;

type Translate = (key: string) => string;

/** The words a Go Live report uses. Products use the defaults; the blog names its own. */
export interface GoLiveWords {
	/** Prefix of each gap's translation key: `gap_title`, `blog_gap_title`. */
	gapPrefix: string;
	done: string;
	blocked: string;
}

const PRODUCT_WORDS: GoLiveWords = { gapPrefix: 'gap_', done: 'go_live_done', blocked: 'go_live_blocked' };

/** The blog's words: "The post is live", "Title" rather than "Name". */
export const BLOG_GO_LIVE_WORDS: GoLiveWords = {
	gapPrefix: 'blog_gap_',
	done: 'blog_go_live_done',
	blocked: 'blog_go_live_blocked',
};

function gapKey(field: string, words: GoLiveWords): string {
	return `${words.gapPrefix}${field.split(':')[0]}`;
}

/** Each gap in words, with its language. */
export function goLiveLabels(
	gaps: readonly GoLiveGap[],
	translate: Translate,
	words: GoLiveWords = PRODUCT_WORDS,
): string[] {
	return gaps.map(({ field, locale }) => {
		const detail = words === PRODUCT_WORDS ? field.split(':').slice(1).join(' ') : '';
		const label = [translate(gapKey(field, words)), detail].filter(Boolean).join(' ');
		return locale ? `${LANGUAGE_NAMES[locale] ?? locale}: ${label}` : label;
	});
}

interface Toasts {
	showSuccess(message: string): void;
	showError(message: string): void;
}

/** One toast for a form and its list. */
export function goLiveToast(
	result: GoLiveResult,
	toasts: Toasts,
	translate: Translate,
	words: GoLiveWords = PRODUCT_WORDS,
): void {
	if (result.live) {
		toasts.showSuccess(translate(words.done));
		return;
	}
	const labels = goLiveLabels(result.gaps, translate, words);
	const more = labels.length - SHOWN_IN_TOAST;
	const shown = labels.slice(0, SHOWN_IN_TOAST).join(', ');
	toasts.showError(`${translate(words.blocked)} ${shown}${more > 0 ? ` (+${more})` : ''}`);
}

/** The gaps a refused save carries back as field issues: `[field, locale]`. */
export function gapsFromError(error: unknown): GoLiveGap[] {
	const issues = error instanceof HttpErrorResponse ? error.error?.error?.issues : undefined;
	if (!Array.isArray(issues)) return [];
	return issues
		.filter((issue: { code?: string }) => issue.code === 'go_live_blocked')
		.map((issue: { path: string[] }) => ({ field: String(issue.path[0]), locale: issue.path[1] || null }));
}
