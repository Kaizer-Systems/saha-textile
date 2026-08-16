import { isPlatformServer } from '@angular/common';
import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest, HttpResponse } from '@angular/common/http';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';

import { Observable, of } from 'rxjs';

@Injectable()
export class ServerInterceptor implements HttpInterceptor {
	private platformId = inject<Object>(PLATFORM_ID);

	intercept<T>(req: HttpRequest<T>, next: HttpHandler): Observable<HttpEvent<T>> {
		if (isPlatformServer(this.platformId)) {
			// Short-circuits every HTTP call during server rendering: the render pass emits markup
			// without waiting on the network, and the browser makes the real request after
			// hydration. Not a mock — nothing is being stood in for. The response is genuinely
			// empty because on the server there is deliberately no call.
			const emptyResponse = new HttpResponse({ body: {} as T, status: 200 });
			return of(emptyResponse);
		} else {
			// Pass the request to the next handler if not on the server
			return next.handle(req);
		}
	}
}
0;
