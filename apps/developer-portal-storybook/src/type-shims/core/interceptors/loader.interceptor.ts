import { HttpContextToken } from '@angular/common/http';

/**
 * Compiler-only stand-in for the two application-local `@core/interceptors/loader.interceptor`
 * modules. `@core/*` resolves to the storefront first, but admin code imports its own loader's
 * `NO_PAGE_COVER` request mark (the Inbox's calls and the minute checks). Webpack resolves the
 * runtime import to the right application's file from the importing component's issuer.
 */
export const NO_PAGE_COVER = new HttpContextToken<boolean>(() => false);
