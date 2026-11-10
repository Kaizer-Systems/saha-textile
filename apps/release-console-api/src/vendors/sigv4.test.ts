import { describe, expect, it } from 'vitest';

import { signV4 } from './sigv4.js';

describe('signature version 4', () => {
	it('matches the worked example in the AWS documentation', () => {
		const headers = signV4({
			method: 'GET',
			url: new URL('https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08'),
			region: 'us-east-1',
			service: 'iam',
			accessKey: 'AKIDEXAMPLE',
			secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
			amzDate: '20150830T123600Z',
			headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
		});
		expect(headers['authorization']).toBe(
			'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
		);
	});
});
