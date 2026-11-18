// WebAuthn's NotAllowedError is intentionally ambiguous: it may mean a timeout,
// user cancellation, or an authenticator that did not satisfy the request.
export function passkeyErrorKey(error, stage) {
  if (stage === 'options' && error?.message === 'invalidCredentials') return 'passkeyPasswordInvalid'
  if (stage === 'options') return 'passkeyOptionsFailed'
  if (stage === 'verify') return 'passkeyVerifyFailed'
  const code = error?.code || ''
  const name = error?.cause?.name || error?.name || ''
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || name === 'InvalidStateError') return 'passkeyAlreadyRegistered'
  if (code === 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT' || name === 'ConstraintError') return 'passkeyUserVerificationRequired'
  if (name === 'SecurityError' || code === 'ERROR_INVALID_RP_ID' || code === 'ERROR_INVALID_DOMAIN') return 'passkeySameOrigin'
  return 'passkeyDeviceFailed'
}
