import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  CODE_TAKEN_MESSAGE,
  FORBIDDEN_MESSAGE,
  INSTITUTION_CODE_MESSAGE,
  NAME_TAKEN_MESSAGE,
  OFFICE_CODE_MAX,
  OFFICE_CODE_PREFIX,
  SERVER_ERROR_MESSAGE,
  composeOfficeCode,
  hasPrefix,
  institutionCodeProblem,
  officeCodeProblem,
  officePart,
  officeSaveError,
} from '../../src/lib/ui/office-code.js';

const apiError = (status, code, message = 'x', details = null) => Object.assign(new Error(message), { name: 'ApiError', status, code, details });

describe('institution code format', () => {
  it('accepts 2 to 10 uppercase letters or digits', () => {
    for (const ok of ['PUP', 'PU', 'P2', 'PUP2026', 'ABCDEFGHIJ', '12', ' PUP ']) assert.equal(institutionCodeProblem(ok), null, ok);
  });

  it('rejects everything else with the 2-10 uppercase letters or digits message', () => {
    for (const bad of ['', ' ', 'P', 'ABCDEFGHIJK', 'pup', 'Pup', 'PU-P', 'PUP!', 'PÚP', 'P U P', null, undefined]) {
      assert.equal(institutionCodeProblem(bad), INSTITUTION_CODE_MESSAGE, String(bad));
    }
    assert.match(INSTITUTION_CODE_MESSAGE, /2 to 10 uppercase letters or digits/);
  });
});

describe('office code prefix', () => {
  it('is off until Core can supply an institution code', () => {
    assert.equal(OFFICE_CODE_PREFIX, null);
    assert.equal(composeOfficeCode(OFFICE_CODE_PREFIX, ' CAMP-ACAD '), 'CAMP-ACAD');
  });

  it('builds the full code from the fixed prefix and the office part', () => {
    assert.equal(composeOfficeCode('PUP', 'OSAS'), 'PUP-OSAS');
    assert.equal(composeOfficeCode('PUP', '  OSAS '), 'PUP-OSAS');
    assert.equal(composeOfficeCode('PUP', ''), 'PUP-');
  });

  it('editing a prefixed code shows only the office part, so the prefix is never written twice', () => {
    assert.equal(officePart('PUP', 'PUP-OSAS'), 'OSAS');
    assert.equal(officePart('PUP', 'pup-osas'), 'osas');
    assert.equal(composeOfficeCode('PUP', officePart('PUP', 'PUP-OSAS')), 'PUP-OSAS');
    assert.equal(officePart('PUP', 'PUP-PUP-X'), 'PUP-X');
    assert.equal(hasPrefix('PUP', 'PUP-OSAS'), true);
    assert.equal(hasPrefix('PUP', 'PUPOSAS'), false);
    assert.equal(hasPrefix(null, 'PUP-OSAS'), false);
  });

  it('an existing code without the prefix has no separate part (it is shown whole until it is re-coded)', () => {
    assert.equal(officePart('PUP', 'CAMP-OSAS'), null);
    assert.equal(officePart('PUP', ''), null);
    assert.equal(officePart(null, 'CAMP-OSAS'), null);
  });
});

describe('office code length', () => {
  it('allows up to 20 characters counting the prefix and the hyphen', () => {
    assert.equal(OFFICE_CODE_MAX, 20);
    assert.equal(officeCodeProblem('PUP', 'A'.repeat(16)), null); // PUP- + 16 = 20
    assert.match(officeCodeProblem('PUP', 'A'.repeat(17)), /21 characters.*at most 20 characters including the hyphen.*at most 16/);
    assert.equal(officeCodeProblem(null, 'A'.repeat(20)), null);
    assert.match(officeCodeProblem(null, 'A'.repeat(21)), /at most 20/);
  });

  it('needs something typed', () => {
    for (const empty of ['', '   ', null, undefined]) assert.equal(officeCodeProblem('PUP', empty), 'Office code is required');
  });
});

describe('what a failed save says', () => {
  it('a duplicate code says exactly "Office code already exists", under the code field', () => {
    const result = officeSaveError(apiError(409, 'OFFICE_CODE_EXISTS', 'Office code already exists', { office_code: 'Office code already exists' }));
    assert.deepEqual(result, { fieldErrors: { office_code: 'Office code already exists' }, message: null });
    assert.equal(CODE_TAKEN_MESSAGE, 'Office code already exists');
    assert.equal(officeSaveError(apiError(409, 'OFFICE_CODE_EXISTS')).fieldErrors.office_code, 'Office code already exists');
  });

  it('a duplicate name is reported under the name field', () => {
    assert.deepEqual(officeSaveError(apiError(409, 'OFFICE_NAME_EXISTS', 'x', { office_name: 'x' })).fieldErrors, { office_name: NAME_TAKEN_MESSAGE });
    assert.deepEqual(officeSaveError(apiError(409, 'OFFICE_CODE_EXISTS', 'x', { office_code: 'x', office_name: 'x' })).fieldErrors, { office_code: CODE_TAKEN_MESSAGE, office_name: NAME_TAKEN_MESSAGE });
  });

  it('a code over 20 characters names the length limit', () => {
    const result = officeSaveError(apiError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields', { office_code: 'Office code must be 20 characters or fewer' }), 'PUP');
    assert.match(result.fieldErrors.office_code, /at most 20 characters including the hyphen.*at most 16/);
    assert.match(officeSaveError(apiError(400, 'VALIDATION_ERROR', 'x', { office_code: 'Office code must be 20 characters or fewer' })).fieldErrors.office_code, /at most 20 characters including the hyphen\.$/);
  });

  it('other field errors from the service are shown next to their fields', () => {
    assert.deepEqual(officeSaveError(apiError(400, 'VALIDATION_ERROR', 'x', { office_name: 'Office name is required', office_code: 'Office code is required' })).fieldErrors, { office_code: 'Office code is required', office_name: 'Office name is required' });
  });

  it('an invalid institution code explains the 2-10 uppercase letters or digits rule', () => {
    assert.deepEqual(officeSaveError(apiError(400, 'VALIDATION_ERROR', 'x', { institution_code: 'bad' })).fieldErrors, { institution_code: INSTITUTION_CODE_MESSAGE });
  });

  it('403 gives a permission message with no server detail', () => {
    const result = officeSaveError(apiError(403, 'FORBIDDEN', 'Insufficient role at /srv/app/route.js:42'));
    assert.deepEqual(result, { fieldErrors: {}, message: FORBIDDEN_MESSAGE });
    assert.doesNotMatch(result.message, /srv|route\.js|Insufficient/);
  });

  it('a network failure and a server error give safe messages', () => {
    assert.equal(officeSaveError(apiError(undefined, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.')).message, 'Cannot reach the server. Check your connection and try again.');
    for (const status of [500, 502, 503]) {
      const result = officeSaveError(apiError(status, 'INTERNAL_ERROR', 'TypeError: cannot read properties of undefined at pg.js:9'));
      assert.equal(result.message, SERVER_ERROR_MESSAGE, String(status));
      assert.doesNotMatch(result.message, /TypeError|pg\.js/);
    }
  });
});
