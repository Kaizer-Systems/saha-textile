import { isPlatformServer } from '@angular/common';
import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';

import { Observable, of } from 'rxjs';

@Injectable()
export class ServerInterceptor implements HttpInterceptor {
  private platformId = inject<Object>(PLATFORM_ID);

  intercept<T>(req: HttpRequest<T>, next: HttpHandler): Observable<HttpEvent<T>> {
    if (isPlatformServer(this.platformId)) {
      // Mock a response for SSR
      const mockResponse = new HttpResponse({ body: {} as T, status: 200 });
      return of(mockResponse);
    } else {
      // Pass the request to the next handler if not on the server
      return next.handle(req);
    }
  }
}
