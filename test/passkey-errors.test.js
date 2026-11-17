import test from 'node:test'
import assert from 'node:assert/strict'
import { passkeyErrorKey } from '../src/frontend/utils/passkeyErrors.js'

test('registration failures identify the stage without claiming a cause for ambiguous cancellation', () => {
  assert.equal(passkeyErrorKey(new Error('invalidCredentials'), 'options'), 'passkeyPasswordInvalid')
  assert.equal(passkeyErrorKey(new Error('offline'), 'options'), 'passkeyOptionsFailed')
  assert.equal(passkeyErrorKey(new Error('rejected'), 'verify'), 'passkeyVerifyFailed')
  assert.equal(passkeyErrorKey({ code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' }, 'device'), 'passkeyAlreadyRegistered')
  assert.equal(passkeyErrorKey({ code: 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT' }, 'device'), 'passkeyUserVerificationRequired')
  assert.equal(passkeyErrorKey({ name: 'WebAuthnError', cause: { name: 'SecurityError' } }, 'device'), 'passkeySameOrigin')
  assert.equal(passkeyErrorKey({ name: 'WebAuthnError', cause: { name: 'NotAllowedError' } }, 'device'), 'passkeyDeviceFailed')
})
