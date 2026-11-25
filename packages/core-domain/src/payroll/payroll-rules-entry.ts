/**
 * The `payroll-rules` subpath: what the admin's payroll screens work out the same way as the run (brief 26): a State's
 * professional tax and its starting sets, and income tax's section 126 groups and rent cities.
 */
export * from './pt-starting-sets';
export {
	HEALTH_126_2026,
	RENT_CITIES_2026,
	healthByGroup,
	type Health126Limits,
	type HealthByGroup,
	type HealthCover,
} from './income-tax';
export { CODE_WAGE_HEADS, type WageHead } from './payroll-rules';
export { CODE_ON_WAGES_FROM } from './bonus';
export * from './leave';
export * from './attendance-days';
export * from './salary-revision';
export * from './payslip-edits';
