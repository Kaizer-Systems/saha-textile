import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a running shop. Start the API and the storefront first, or point
 * `E2E_BASE_URL` at a production build. Uses the installed Chrome, so no browser download.
 */
export default defineConfig({
	testDir: './e2e',
	outputDir: process.env['E2E_OUTPUT'] ?? 'node_modules/.cache/playwright',
	fullyParallel: true,
	forbidOnly: !!process.env['CI'],
	retries: 0,
	workers: 4,
	timeout: 45_000,
	expect: { timeout: 10_000 },
	reporter: [['list']],
	use: {
		baseURL: process.env['E2E_BASE_URL'] ?? 'https://localhost:4200',
		ignoreHTTPSErrors: true,
		channel: 'chrome',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		// A test that only applies to one screen carries `@desktop-only` or `@phone-only`, and the other project leaves it
		// out, so every test listed runs (none reports as skipped).
		{
			name: 'desktop',
			testIgnore: /admin/,
			grepInvert: /@phone-only/,
			use: { ...devices['Desktop Chrome'], channel: 'chrome' },
		},
		{
			name: 'phone',
			// proof.spec.ts checks data and server behaviour, proven once on the laptop project.
			testIgnore: [/admin/, /proof\.spec\.ts/],
			grepInvert: /@desktop-only/,
			use: { ...devices['Pixel 7'], channel: 'chrome' },
		},
		{ name: 'admin-setup', testMatch: /admin\.setup\.ts/, use: { channel: 'chrome' } },
		{
			name: 'admin',
			testMatch: /admin\.spec\.ts/,
			testIgnore: /dark-mode\.admin\.spec\.ts/,
			dependencies: ['admin-setup'],
			use: {
				...devices['Desktop Chrome'],
				channel: 'chrome',
				storageState: 'node_modules/.cache/playwright/admin-state.json',
			},
		},
		// The light/dark comparison loads each screen twice; it runs after every other project, when no test is placing
		// orders or changing products, so both loads read the same data.
		{
			name: 'admin-visual',
			testMatch: /dark-mode\.admin\.spec\.ts/,
			dependencies: ['admin', 'desktop', 'phone'],
			use: {
				...devices['Desktop Chrome'],
				channel: 'chrome',
				storageState: 'node_modules/.cache/playwright/admin-state.json',
			},
		},
	],
});
