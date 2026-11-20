import { type Page, expect, test } from '@playwright/test';

/**
 * The console in a browser, against its own API with an empty data folder and no Mac helper
 * (see playwright.config.ts). Desktop and phone share that data, so each step works whether the
 * PIN or the project already exists.
 */
const PIN = '135790';

/** Opens the console: sets the PIN on the first run, otherwise types it. */
async function unlock(page: Page): Promise<void> {
	await page.goto('/');
	const first = page.getByText('First time: choose a 6-digit console PIN.');
	const again = page.getByText(/Enter your 6-digit console PIN/);
	await expect(first.or(again)).toBeVisible();
	if (await first.isVisible()) {
		await page.keyboard.type(PIN);
		await expect(page.getByText(/again/i).first()).toBeVisible();
	}
	await page.keyboard.type(PIN);
	await expect(page.getByRole('heading', { name: 'All projects' })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('the PIN is typed straight into the six boxes; a wrong one is refused; Lock closes the console', async ({
	page,
}) => {
	await unlock(page);
	await page.getByRole('button', { name: /Lock/ }).first().click();
	await expect(page.getByText(/Enter your 6-digit console PIN/)).toBeVisible();
	await page.keyboard.type('000000');
	await expect(page.getByText(/Wrong PIN/i)).toBeVisible();
	await page.keyboard.type(PIN);
	await expect(page.getByRole('heading', { name: 'All projects' })).toBeVisible();
});

test('the wizard adds a project with a GitHub repository and lands on its Connections', async ({ page }, info) => {
	const name = `Browser test ${info.project.name}`;
	await unlock(page);
	await page
		.getByRole('button', { name: /Add a project/ })
		.first()
		.click();
	await page.getByLabel('Project').fill(name);
	await page.getByPlaceholder('Clients, Personal…').fill('Tests');
	await page.getByRole('button', { name: /^Next/ }).click();
	await page.getByRole('radio', { name: /GitHub pull requests/ }).click();
	await page.getByPlaceholder('Kaizer-Systems/shop-web').fill('Kaizer-Systems/saha-textile');
	await page.getByPlaceholder('storefront, API, admin…').fill('monorepo');
	await page.getByRole('button', { name: /Add repository/ }).click();
	await expect(page.getByRole('cell', { name: 'Kaizer-Systems/saha-textile' })).toBeVisible();
	const next = page.getByRole('button', { name: /^Next/ });
	await next.click();
	// Environments: Next waits until every environment has a domain (owner, 20 Nov).
	await expect(next).toBeDisabled();
	await expect(page.getByText('Give Staging at least one domain', { exact: false })).toBeVisible();
	const domains = page.getByPlaceholder('shop.example.com, admin.example.com');
	await domains.nth(1).fill('staging.example.com');
	await domains.nth(2).fill('example.com, www.example.com');
	await next.click();
	// Cloud platforms: the cloud Staging and Production run on is ticked and stays ticked.
	await expect(page.getByText('Staging and Production run here')).toBeVisible();
	await page.getByRole('checkbox', { name: /DigitalOcean/ }).click();
	await expect(page.getByText(/Move them on Environments first/)).toBeVisible();
	await next.click();
	// Edge and DNS: Cloudflare needs the domain it holds.
	await expect(next).toBeDisabled();
	await page.getByPlaceholder('example.com', { exact: true }).fill('example.com');
	await next.click();
	// Secrets: each environment chooses, here no manager.
	await expect(next).toBeDisabled();
	for (const chip of await page.getByRole('button', { name: 'no manager' }).all()) await chip.click();
	await next.click();
	await next.click();
	await expect(page.getByRole('heading', { name: /Add a project · Done/i })).toBeVisible();
	await page.getByRole('button', { name: 'Add project', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Connections' })).toBeVisible();
	await expect(page.getByText('not connected').first()).toBeVisible();
	await expect(page.getByText('not written yet')).toBeVisible();
	await page.goto('/console/projects');
	await expect(page.getByRole('heading', { name })).toBeVisible();
});

test('Live deploy without the Mac helper says so and shows what to do', async ({ page }, info) => {
	const id = `browser-test-${info.project.name}`;
	await unlock(page);
	await page.goto(`/p/${id}/r/saha-textile/deploy`);
	await expect(page.getByText(/The Mac helper is not answering/).first()).toBeVisible();
	await expect(page.getByText('What to do')).toBeVisible();
	await expect(page.getByText('pnpm console:up').first()).toBeVisible();
});

test('Watch › Alerts lists the local rules', async ({ page }, info) => {
	await unlock(page);
	await page.goto(`/p/browser-test-${info.project.name}/r/saha-textile/alerts?tab=rules`);
	for (const rule of ['Start-up disk filling', 'A container stopped', 'Mac helper silent', 'Errors rising'])
		await expect(page.getByText(rule)).toBeVisible();
});
