import { Injectable } from '@angular/core';

import { CsrfTokenHolder } from '@saha-textile/http-transport';

/** This application's CSRF token. Root-scoped, so under SSR it never outlives one request. */
@Injectable({ providedIn: 'root' })
export class CsrfTokens extends CsrfTokenHolder {}
