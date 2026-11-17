// Small software authenticator for integration tests: real P-256 signatures,
// with a WebAuthn "none" attestation. It is not part of the application.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const b64url = value => Buffer.from(value).toString('base64url');
const sha256 = value => createHash('sha256').update(value).digest();

function cborHead(major, length) {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);
  if (length < 65536) {
    const head = Buffer.alloc(3);
    head[0] = (major << 5) | 25;
    head.writeUInt16BE(length, 1);
    return head;
  }
  throw new Error('CBOR value too large for test authenticator');
}

function cbor(value) {
  if (typeof value === 'number') {
    return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value);
    return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([cborHead(2, value.length), value]);
  if (value instanceof Map) {
    return Buffer.concat([cborHead(5, value.size), ...[...value].flatMap(([key, val]) => [cbor(key), cbor(val)])]);
  }
  throw new Error('Unsupported CBOR value');
}

export function createAuthenticator({ rpId = 'example.com', credentialId = randomBytes(32) } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = cbor(new Map([
    [1, 2], [3, -7], [-1, 1],
    [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]
  ]));
  const id = Buffer.from(credentialId);
  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(id.length);

  const clientData = (type, challenge, origin, crossOrigin = false, topOrigin) => Buffer.from(JSON.stringify({
    type, challenge, origin, crossOrigin, ...(topOrigin ? { topOrigin } : {})
  }));
  const authData = (flags, counter) => {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    return Buffer.concat([sha256(rpId), Buffer.from([flags]), count]);
  };

  return {
    id: b64url(id),
    registration({ challenge, origin = `https://${rpId}`, userVerified = true, crossOrigin = false, topOrigin }) {
      const client = clientData('webauthn.create', challenge, origin, crossOrigin, topOrigin);
      const flags = 0x41 | (userVerified ? 0x04 : 0); // user present + attested data + UV
      const attested = Buffer.concat([authData(flags, 0), Buffer.alloc(16), idLength, id, cose]);
      const attestation = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', attested]]));
      return {
        id: b64url(id), rawId: b64url(id), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64url(client), attestationObject: b64url(attestation), transports: ['usb'] }
      };
    },
    assertion({ challenge, origin = `https://${rpId}`, userVerified = true, counter = 1, invalidSignature = false, crossOrigin = false, topOrigin }) {
      const client = clientData('webauthn.get', challenge, origin, crossOrigin, topOrigin);
      const data = authData(0x01 | (userVerified ? 0x04 : 0), counter);
      const signature = sign('sha256', Buffer.concat([data, sha256(client)]), privateKey);
      if (invalidSignature) signature[signature.length - 1] ^= 1;
      return {
        id: b64url(id), rawId: b64url(id), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64url(client), authenticatorData: b64url(data), signature: b64url(signature) }
      };
    }
  };
}
