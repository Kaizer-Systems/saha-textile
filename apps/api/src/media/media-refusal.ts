import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * A media decision the calling screen should explain in words: an over-cap photo, an image
 * still in use, missing alt text, a link that is not a YouTube video.
 *
 * The global exception filter replaces every exception's text with a generic safe message,
 * except field `issues`, which it passes through. So a refusal travels as one issue carrying
 * our own wording and a stable `code` — the same shape `domainRefusal` uses for auth — and the
 * admin and storefront read it with `readApiErrorMessage`. Nothing internal is ever in it.
 */
export function mediaRefusal(
	status: HttpStatus,
	code: string,
	message: string,
	extra: Record<string, unknown> = {},
): HttpException {
	return new HttpException(
		{ message: 'Validation failed', issues: [{ path: 'request', message, code, ...extra }] },
		status,
	);
}
