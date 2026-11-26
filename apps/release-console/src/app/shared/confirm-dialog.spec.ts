import { describe, expect, it } from 'vitest';

import { ConfirmDialog } from './confirm-dialog';

describe('the in-console confirm dialog', () => {
	it('answers yes or no, and a new question answers an open one with no', async () => {
		const dialog = new ConfirmDialog();
		const first = dialog.ask({ title: 'Unlink?', body: 'It stays in Infisical.', confirm: 'Unlink', danger: true });
		expect(dialog.open()?.title).toBe('Unlink?');
		const second = dialog.ask({ title: 'Remove?', body: 'Keys stay.', confirm: 'Remove' });
		expect(await first).toBe(false);
		dialog.reply(true);
		expect(await second).toBe(true);
		expect(dialog.open()).toBeNull();
	});
});
