/**
 * The 24 email templates registered with MSG91 (22 from the message-templates document, plus
 * order_payment_link and payment_receipt for this build). Each is registered as `<name>_v1`; the
 * `[[tokens]]` are filled per environment by `fillTokens` just before registering.
 */
export { TEMPLATES, render } from './templates.mjs';
export { checkTemplate, fillTokens, renderSample } from './check.mjs';
