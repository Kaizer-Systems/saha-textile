import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { type ApiErrorCode, ApiErrorResponse, type FieldIssue } from '@saha-textile/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { SessionRefusal } from '../auth/session-refusal';
import { REQUEST_ID_HEADER } from './request-context';

/** HTTP status → stable machine-readable error code. */
const STATUS_TO_CODE: Record<number, ApiErrorCode> = {
	[HttpStatus.BAD_REQUEST]: 'bad_request',
	[HttpStatus.UNAUTHORIZED]: 'unauthorized',
	[HttpStatus.FORBIDDEN]: 'forbidden',
	[HttpStatus.NOT_FOUND]: 'not_found',
	[HttpStatus.CONFLICT]: 'conflict',
	[HttpStatus.PAYLOAD_TOO_LARGE]: 'payload_too_large',
	[HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'unsupported_media_type',
	[HttpStatus.TOO_MANY_REQUESTS]: 'rate_limited',
};

/** Client-safe message per status — used instead of whatever an exception happened to carry. */
const SAFE_MESSAGE: Record<string, string> = {
	bad_request: 'The request could not be processed.',
	validation_failed: 'Request validation failed.',
	unauthorized: 'Authentication is required.',
	forbidden: 'You do not have access to this resource.',
	not_found: 'The requested resource was not found.',
	conflict: 'The request conflicts with the current state.',
	rate_limited: 'Too many requests. Please retry later.',
	payload_too_large: 'The request payload is too large.',
	unsupported_media_type: 'The request media type is not supported.',
	internal: 'Something went wrong.',
};

interface ValidationPayload {
	message?: unknown;
	issues?: Array<{ path?: unknown; message?: unknown; code?: unknown }>;
}

const toFieldIssues = (payload: ValidationPayload): FieldIssue[] =>
	(payload.issues ?? []).map((issue) => ({
		path:
			typeof issue.path === 'string'
				? issue.path.split('.').filter(Boolean)
				: Array.isArray(issue.path)
					? (issue.path as Array<string | number>)
					: [],
		message: typeof issue.message === 'string' ? issue.message : 'Invalid value',
		...(typeof issue.code === 'string' ? { code: issue.code } : {}),
	}));

/**
 * The single place an error becomes an HTTP response.
 *
 * Every failure — thrown `HttpException`, validation rejection, or an unexpected crash —
 * leaves as the same `{ error: { code, message, issues, requestId } }` envelope from
 * `packages/contracts`, so clients never have to guess at a shape.
 *
 * Fail closed (AGENTS §6): the response carries a SAFE message chosen by status, never
 * the raw exception text, so a driver error, a stack trace, a Mongo query, or a provider
 * payload cannot escape. The full error is logged server-side against the same
 * `requestId` the client is given, which is what support correlates on. Validation issues
 * are the deliberate exception — they are about the caller's own input and are safe.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
	private readonly logger = new Logger('HttpException');

	catch(exception: unknown, host: ArgumentsHost): void {
		const context = host.switchToHttp();
		const request = context.getRequest<FastifyRequest>();
		const reply = context.getResponse<FastifyReply>();
		const requestId = request.id ?? null;

		const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
		const payload = exception instanceof HttpException ? exception.getResponse() : null;
		const validation =
			payload && typeof payload === 'object' && Array.isArray((payload as ValidationPayload).issues)
				? (payload as ValidationPayload)
				: null;

		const code: ApiErrorCode = validation ? 'validation_failed' : (STATUS_TO_CODE[status] ?? 'internal');
		const issues = validation ? toFieldIssues(validation) : [];

		if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
			// Log the real cause here — it must never reach the client.
			this.logger.error(
				`${request.method} ${request.url} failed [requestId=${String(requestId)}]`,
				exception instanceof Error ? exception.stack : String(exception),
			);
		}

		// Read from the exception TYPE, never inferred from status or message. A credential
		// endpoint raises a plain `UnauthorizedException`, so it cannot pick up a reason
		// however its message is worded — which is what keeps "wrong PIN" indistinguishable
		// from "PIN locked" to an unauthenticated caller.
		const reason = exception instanceof SessionRefusal ? exception.reason : undefined;

		const body = ApiErrorResponse.parse({
			error: {
				code,
				message: SAFE_MESSAGE[code] ?? SAFE_MESSAGE.internal,
				issues,
				requestId: typeof requestId === 'string' ? requestId : null,
				...(reason ? { reason } : {}),
			},
		});

		void reply
			.status(status)
			.header(REQUEST_ID_HEADER, String(requestId ?? ''))
			.send(body);
	}
}
