/**
 * `@core/*` resolves to the storefront first, but admin code imports its own error handler's
 * `QUIET_ERRORS` token. This shim gives Storybook the storefront handler plus the admin token,
 * so both apps' code type-checks together.
 */
export * from '../../../../../storefront/src/app/core/interceptors/global-error-handler.interceptor';
export { QUIET_ERRORS } from '../../../../../admin/src/app/core/interceptors/global-error-handler.interceptor';
