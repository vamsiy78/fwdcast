import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  RegisterMessage,
  RegisteredMessage,
  RequestMessage,
  ResponseMessage,
  DataMessage,
  EndMessage,
  ExpiredMessage,
  ProtocolMessage,
  serializeMessage,
  deserializeMessage,
  isRegisterMessage,
  isRegisteredMessage,
  isRequestMessage,
  isResponseMessage,
  isDataMessage,
  isEndMessage,
  isExpiredMessage,
  createRegisterMessage,
  createRegisteredMessage,
  createRequestMessage,
  createResponseMessage,
  createDataMessage,
  createEndMessage,
  createExpiredMessage,
} from './protocol';

// ============================================================================
// Arbitraries for generating random protocol messages
// ============================================================================

// Non-empty string arbitrary for required string fields
const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 100 });

// Path arbitrary (can include slashes)
const pathArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-/.'.split('')),
  { minLength: 1, maxLength: 50 }
);

// HTTP method arbitrary
const methodArb = fc.constantFrom('GET', 'HEAD', 'POST', 'PUT', 'DELETE');

// HTTP status code arbitrary
const statusArb = fc.integer({ min: 100, max: 599 });

// Unix timestamp arbitrary (reasonable range)
const timestampArb = fc.integer({ min: 1000000000, max: 2000000000 });

// Headers arbitrary
const headersArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }),
  fc.string({ maxLength: 100 })
);

// Base64 chunk arbitrary (valid base64 characters)
const base64ChunkArb = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='.split('')),
  { maxLength: 1000 }
);

// Arbitrary for RegisterMessage
const registerMessageArb: fc.Arbitrary<RegisterMessage> = fc.record({
  type: fc.constant('register' as const),
  path: pathArb,
  expiresAt: timestampArb,
});

// Arbitrary for RegisteredMessage
const registeredMessageArb: fc.Arbitrary<RegisteredMessage> = fc.record({
  type: fc.constant('registered' as const),
  sessionId: nonEmptyStringArb,
  url: nonEmptyStringArb,
});

// Arbitrary for RequestMessage
const requestMessageArb: fc.Arbitrary<RequestMessage> = fc.record({
  type: fc.constant('request' as const),
  id: nonEmptyStringArb,
  method: methodArb,
  path: pathArb,
});

// Arbitrary for ResponseMessage
const responseMessageArb: fc.Arbitrary<ResponseMessage> = fc.record({
  type: fc.constant('response' as const),
  id: nonEmptyStringArb,
  status: statusArb,
  headers: headersArb,
});

// Arbitrary for DataMessage
const dataMessageArb: fc.Arbitrary<DataMessage> = fc.record({
  type: fc.constant('data' as const),
  id: nonEmptyStringArb,
  chunk: base64ChunkArb,
});

// Arbitrary for EndMessage
const endMessageArb: fc.Arbitrary<EndMessage> = fc.record({
  type: fc.constant('end' as const),
  id: nonEmptyStringArb,
});

// Arbitrary for ExpiredMessage
const expiredMessageArb: fc.Arbitrary<ExpiredMessage> = fc.record({
  type: fc.constant('expired' as const),
});

// Arbitrary for any protocol message
const protocolMessageArb: fc.Arbitrary<ProtocolMessage> = fc.oneof(
  registerMessageArb,
  registeredMessageArb,
  requestMessageArb,
  responseMessageArb,
  dataMessageArb,
  endMessageArb,
  expiredMessageArb
);

describe('Protocol', () => {
  /**
   * Feature: fwdcast, Property 12: Protocol Message Conformance
   * For any tunnel message (register, request, response, data, end),
   * the message should contain all required fields as specified in the protocol.
   * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
   */
  describe('Property 12: Protocol Message Conformance', () => {
    it('RegisterMessage round-trip preserves all required fields', () => {
      fc.assert(
        fc.property(registerMessageArb, (msg) => {
          const serialized = serializeMessage(msg);
          const deserialized = deserializeMessage(serialized);

          expect(deserialized).not.toBeNull();
          expect(isRegisterMessage(deserialized)).toBe(true);

          const result = deserialized as RegisterMessage;
          expect(result.type).toBe('register');
          expect(result.path).toBe(msg.path);
          expect(result.expiresAt).toBe(msg.expiresAt);
        }),
        { numRuns: 100 }
      );
    });

    it('RegisteredMessage round-trip preserves all required fields', () => {
      fc.assert(
        fc.property(registeredMessageArb, (msg) => {
          const serialized = serializeMessage(msg);
          const deserialized = deserializeMessage(serialized);

          expect(deserialized).not.toBeNull();
          expect(isRegisteredMessage(deserialized)).toBe(true);

          const result = deserialized as RegisteredMessage;
          expect(result.type).toBe('registered');
          expect(result.sessionId).toBe(msg.sessionId);
          expect(result.url).toBe(msg.url);
        }),
        { numRuns: 100 }
      );
    });

    it('RequestMessage round-trip preserves all required fields', () => {
      fc.assert(
        fc.property(requestMessageArb, (msg) => {
          const serialized = serializeMessage(msg);
          const deserialized = deserializeMessage(serialized);

          expect(deserialized).not.toBeNull();
          expect(isRequestMessage(deserialized)).toBe(true);

          const result = deserialized as RequestMessage;
          expect(result.type).toBe('request');
          expect(result.id).toBe(msg.id);
          expect(result.method).toBe(msg.method);
          expect(result.path).toBe(msg.path);
        }),
        { numRuns: 100 }
      );
    });

    it('ResponseMessage round-trip preserves all required fields', () => {
      fc.assert(
        fc.property(responseMessageArb, (msg) => {
          const serialized = serializeMessage(msg);
          const deserialized = deserializeMessage(serialized);

          expect(deserialized).not.toBeNull();
          expect(isResponseMessage(deserialized)).toBe(true);

          const result = deserialized as ResponseMessage;
          expect(result.type).toBe('response');
          expect(result.id).toBe(msg.id);
          expect(result.status).toBe(msg.status);
          expect(result.headers).toEqual(msg.headers);
        }),
        { numRuns: 100 }
      );
    });

    it('DataMessage round-trip preserves all required fields', () => {
      fc.assert(
        fc.property(dataMessageArb, (msg) => {
          const serialized = serializeMessage(msg);
          const deserialized = deserializeMessage(serialized);

          expect(deserialized).not.toBeNull();
          expect(isDataMessage(deserialized)).toBe(true);

          const result = deserialized as DataMessage;
          expect(result.type).toBe('data');
          expect(result.id).toBe(msg.id);
          expect(result.chunk).toBe(msg.chunk);
        }),
        { numRuns: 100 }
      );
    });

    it('EndMessage round-trip preserves all required fields', () => {
      fc.assert(
        fc.property(endMessageArb, (msg) => {
          const serialized = serializeMessage(msg);
          const deserialized = deserializeMessage(serialized);

          expect(deserialized).not.toBeNull();
          expect(isEndMessage(deserialized)).toBe(true);

          const result = deserialized as EndMessage;
          expect(result.type).toBe('end');
          expect(result.id).toBe(msg.id);
        }),
        { numRuns: 100 }
      );
    });

    it('ExpiredMessage round-trip preserves all required fields', () => {
      fc.assert(
        fc.property(expiredMessageArb, (msg) => {
          const serialized = serializeMessage(msg);
          const deserialized = deserializeMessage(serialized);

          expect(deserialized).not.toBeNull();
          expect(isExpiredMessage(deserialized)).toBe(true);

          const result = deserialized as ExpiredMessage;
          expect(result.type).toBe('expired');
        }),
        { numRuns: 100 }
      );
    });

    it('Any protocol message round-trip preserves type and required fields', () => {
      fc.assert(
        fc.property(protocolMessageArb, (msg) => {
          const serialized = serializeMessage(msg);
          const deserialized = deserializeMessage(serialized);

          expect(deserialized).not.toBeNull();
          expect(deserialized!.type).toBe(msg.type);

          // Verify type-specific fields based on message type
          switch (msg.type) {
            case 'register':
              expect(isRegisterMessage(deserialized)).toBe(true);
              break;
            case 'registered':
              expect(isRegisteredMessage(deserialized)).toBe(true);
              break;
            case 'request':
              expect(isRequestMessage(deserialized)).toBe(true);
              break;
            case 'response':
              expect(isResponseMessage(deserialized)).toBe(true);
              break;
            case 'data':
              expect(isDataMessage(deserialized)).toBe(true);
              break;
            case 'end':
              expect(isEndMessage(deserialized)).toBe(true);
              break;
            case 'expired':
              expect(isExpiredMessage(deserialized)).toBe(true);
              break;
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Message factories create valid messages', () => {
    it('createRegisterMessage creates valid message', () => {
      fc.assert(
        fc.property(pathArb, timestampArb, (path, expiresAt) => {
          const msg = createRegisterMessage(path, expiresAt);
          expect(isRegisterMessage(msg)).toBe(true);
          expect(msg.path).toBe(path);
          expect(msg.expiresAt).toBe(expiresAt);
        }),
        { numRuns: 100 }
      );
    });

    it('createRegisteredMessage creates valid message', () => {
      fc.assert(
        fc.property(nonEmptyStringArb, nonEmptyStringArb, (sessionId, url) => {
          const msg = createRegisteredMessage(sessionId, url);
          expect(isRegisteredMessage(msg)).toBe(true);
          expect(msg.sessionId).toBe(sessionId);
          expect(msg.url).toBe(url);
        }),
        { numRuns: 100 }
      );
    });

    it('createRequestMessage creates valid message', () => {
      fc.assert(
        fc.property(nonEmptyStringArb, methodArb, pathArb, (id, method, path) => {
          const msg = createRequestMessage(id, method, path);
          expect(isRequestMessage(msg)).toBe(true);
          expect(msg.id).toBe(id);
          expect(msg.method).toBe(method);
          expect(msg.path).toBe(path);
        }),
        { numRuns: 100 }
      );
    });

    it('createResponseMessage creates valid message', () => {
      fc.assert(
        fc.property(nonEmptyStringArb, statusArb, headersArb, (id, status, headers) => {
          const msg = createResponseMessage(id, status, headers);
          expect(isResponseMessage(msg)).toBe(true);
          expect(msg.id).toBe(id);
          expect(msg.status).toBe(status);
          expect(msg.headers).toEqual(headers);
        }),
        { numRuns: 100 }
      );
    });

    it('createDataMessage creates valid message', () => {
      fc.assert(
        fc.property(nonEmptyStringArb, base64ChunkArb, (id, chunk) => {
          const msg = createDataMessage(id, chunk);
          expect(isDataMessage(msg)).toBe(true);
          expect(msg.id).toBe(id);
          expect(msg.chunk).toBe(chunk);
        }),
        { numRuns: 100 }
      );
    });

    it('createEndMessage creates valid message', () => {
      fc.assert(
        fc.property(nonEmptyStringArb, (id) => {
          const msg = createEndMessage(id);
          expect(isEndMessage(msg)).toBe(true);
          expect(msg.id).toBe(id);
        }),
        { numRuns: 100 }
      );
    });

    it('createExpiredMessage creates valid message', () => {
      const msg = createExpiredMessage();
      expect(isExpiredMessage(msg)).toBe(true);
    });
  });

  describe('Invalid message handling', () => {
    it('deserializeMessage returns null for invalid JSON', () => {
      expect(deserializeMessage('not valid json')).toBeNull();
      expect(deserializeMessage('{')).toBeNull();
      expect(deserializeMessage('')).toBeNull();
    });

    it('deserializeMessage returns null for unknown message types', () => {
      expect(deserializeMessage('{"type": "unknown"}')).toBeNull();
      expect(deserializeMessage('{"type": "foo"}')).toBeNull();
    });

    it('deserializeMessage returns null for messages missing required fields', () => {
      // Register missing path
      expect(deserializeMessage('{"type": "register", "expiresAt": 123}')).toBeNull();
      // Register missing expiresAt
      expect(deserializeMessage('{"type": "register", "path": "/test"}')).toBeNull();
      // Request missing id
      expect(deserializeMessage('{"type": "request", "method": "GET", "path": "/"}')).toBeNull();
      // Response missing headers
      expect(deserializeMessage('{"type": "response", "id": "1", "status": 200}')).toBeNull();
    });
  });
});
