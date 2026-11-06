import { HttpContext, HttpContextToken } from '@angular/common/http';

/**
 * Marks a read that has its own empty state, so a failure needs no toast. This stays inside the
 * app: a custom header would also travel to the API and need a CORS allowance there.
 */
export const BACKGROUND_REQUEST = new HttpContextToken<boolean>(() => false);

export const backgroundRequest = (): HttpContext => new HttpContext().set(BACKGROUND_REQUEST, true);
