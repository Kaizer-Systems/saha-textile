import { createHash } from 'node:crypto';

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

/** Content hash of a public JSON body. A later save changes the body, so the tag changes. */
export function catalogEtag(body: unknown): string {
	return `"${createHash('sha1').update(JSON.stringify(body)).digest('hex')}"`;
}

@Injectable()
export class CatalogEtagInterceptor implements NestInterceptor {
	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		return next.handle().pipe(
			map((body: unknown) => {
				const reply = context.switchToHttp().getResponse<{
					header: (name: string, value: string) => void;
					status: (code: number) => void;
				}>();
				const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
				const etag = catalogEtag(body);
				reply.header('etag', etag);
				if (request.headers['if-none-match'] === etag) reply.status(304);
				return body;
			}),
		);
	}
}
