import { type CodedRefusalIssue, codedRefusal } from '../common/coded-refusal';

/**
 * An accounts refusal the admin explains in its own words (`rf_problem_…`, `inv_problem_…`, `si_problem_…`). The error
 * filter sends only `issues[]`, never an exception's message, so the code travels as the issue, as `codedRefusal`
 * does; it is also the issue's text and the exception's own message, which is what the screens' word keys are found by.
 *
 *   throw new ConflictException(accountsRefusal('self_invoice_changed'));
 */
export function accountsRefusal(code: string): { message: string; issues: CodedRefusalIssue[] } {
	return { ...codedRefusal(code, code), message: code };
}
