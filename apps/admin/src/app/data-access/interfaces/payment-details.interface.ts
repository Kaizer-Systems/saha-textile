export interface IPaymentDetails {
	id?: number;
	user_id?: number;
	bank_name?: string;
	bank_holder_name?: string;
	bank_account_no?: string | number;
	ifsc?: string;
	swift?: string;
	paypal_email?: string;
	created_at?: string;
	updated_at?: string;
}
