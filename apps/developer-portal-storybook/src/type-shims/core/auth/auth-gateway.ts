/**
 * NEXT-GEN-UI · Storybook dual-application auth type bridge
 * What: exposes both application-specific auth gateways to Storybook's single compiler.
 * Why: Storefront and Admin intentionally own different exports at the same `@core` alias;
 * one ordered wildcard mapping can resolve only one of them during combined typechecking.
 * How: re-export the real type-only boundaries while runtime issuer aliases keep each story
 * on its own application implementation.
 * Tuning knobs: add only colliding application boundary exports; never merge their policy.
 */
export * from '../../../../../admin/src/app/core/auth/auth-gateway';
export * from '../../../../../storefront/src/app/core/auth/auth-gateway';
