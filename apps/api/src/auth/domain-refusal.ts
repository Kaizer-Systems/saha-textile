import { BadRequestException } from '@nestjs/common';

/**
 * A refusal the CLIENT is meant to recognise, carried on the one channel that survives.
 *
 * ## Why this exists
 *
 * `HttpExceptionFilter` derives the envelope's `code` from the HTTP STATUS and replaces the
 * message with a safe one — deliberately, so a driver error or a provider payload can never
 * escape through an exception's text. The consequence is that a handler throwing
 * `new BadRequestException({ code: 'last_credential' })` reaches the browser as
 * `{ code: 'bad_request', message: 'The request could not be processed.' }`: the stable code is
 * discarded on the way out.
 *
 * That silently defeated every stable code in the auth surface — the thirteen documented signup
 * codes, `oauth_state_invalid`, `step_up_required` and, worst of the set, `last_credential`.
 * Somebody disconnecting the only way back into their account was told "Something went wrong"
 * instead of "that is the only way left to sign in", which is precisely the moment the real
 * reason matters.
 *
 * `issues[]` is the exception the filter already makes, because issues describe the caller's own
 * request rather than the server's internals, and `issues[].code` is preserved verbatim. So a
 * domain refusal travels there. `assertPasswordAcceptable` already used this channel; this makes
 * it the one way, rather than one of two with only one of them working.
 *
 * `ApiErrorCode` is deliberately NOT widened to hold these: it describes the transport outcome,
 * and a closed enum of ten is what lets a client switch on it exhaustively. Domain vocabulary
 * belongs beside the domain, not in the envelope.
 */
export function domainRefusal(code: string, message: string): BadRequestException {
	return new BadRequestException({
		message: 'Validation failed',
		// `path` names what was refused rather than a form field: these are decisions about
		// account state, and pretending otherwise would put a misleading anchor on the issue.
		issues: [{ path: 'request', message, code }],
	});
}
