/**
 * Tunnel Protocol Types and Validation
 * 
 * Defines the WebSocket-based protocol for communication between
 * the CLI and Relay Server.
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

// ============================================================================
// Message Types
// ============================================================================

/**
 * CLI → Relay: Registration message
 * Sent when CLI connects to register a new session
 * Requirements: 5.1
 */
export interface RegisterMessage {
  type: 'register';
  path: string;
  expiresAt: number; // Unix timestamp
  password?: string; // Optional password protection
}

/**
 * Relay → CLI: Registration response
 * Sent after successful session creation
 * Requirements: 5.1
 */
export interface RegisteredMessage {
  type: 'registered';
  sessionId: string;
  url: string;
}

/**
 * Relay → CLI: Forward HTTP request
 * Sent when a viewer requests a resource
 * Requirements: 5.2
 */
export interface RequestMessage {
  type: 'request';
  id: string;      // Unique request ID
  method: string;  // GET, HEAD
  path: string;    // Requested path within share
}

/**
 * CLI → Relay: Response headers
 * Sent to start the response for a request
 * Requirements: 5.3
 */
export interface ResponseMessage {
  type: 'response';
  id: string;
  status: number;
  headers: Record<string, string>;
}

/**
 * CLI → Relay: Response body chunk
 * Sent for each chunk of response data
 * Requirements: 5.4
 */
export interface DataMessage {
  type: 'data';
  id: string;
  chunk: string; // Base64 encoded
}

/**
 * CLI → Relay: Response complete
 * Sent when response streaming is finished
 * Requirements: 5.5
 */
export interface EndMessage {
  type: 'end';
  id: string;
}

/**
 * Relay → CLI: Session expired
 * Sent when the session has expired
 */
export interface ExpiredMessage {
  type: 'expired';
}

/**
 * Union type of all protocol messages
 */
export type ProtocolMessage =
  | RegisterMessage
  | RegisteredMessage
  | RequestMessage
  | ResponseMessage
  | DataMessage
  | EndMessage
  | ExpiredMessage;

/**
 * Message type literals for type guards
 */
export type MessageType = ProtocolMessage['type'];

// ============================================================================
// Type Guards
// ============================================================================

export function isRegisterMessage(msg: unknown): msg is RegisterMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as RegisterMessage).type === 'register' &&
    typeof (msg as RegisterMessage).path === 'string' &&
    typeof (msg as RegisterMessage).expiresAt === 'number'
  );
}

export function isRegisteredMessage(msg: unknown): msg is RegisteredMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as RegisteredMessage).type === 'registered' &&
    typeof (msg as RegisteredMessage).sessionId === 'string' &&
    typeof (msg as RegisteredMessage).url === 'string'
  );
}

export function isRequestMessage(msg: unknown): msg is RequestMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as RequestMessage).type === 'request' &&
    typeof (msg as RequestMessage).id === 'string' &&
    typeof (msg as RequestMessage).method === 'string' &&
    typeof (msg as RequestMessage).path === 'string'
  );
}

export function isResponseMessage(msg: unknown): msg is ResponseMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as ResponseMessage).type === 'response' &&
    typeof (msg as ResponseMessage).id === 'string' &&
    typeof (msg as ResponseMessage).status === 'number' &&
    typeof (msg as ResponseMessage).headers === 'object' &&
    (msg as ResponseMessage).headers !== null
  );
}

export function isDataMessage(msg: unknown): msg is DataMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as DataMessage).type === 'data' &&
    typeof (msg as DataMessage).id === 'string' &&
    typeof (msg as DataMessage).chunk === 'string'
  );
}

export function isEndMessage(msg: unknown): msg is EndMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as EndMessage).type === 'end' &&
    typeof (msg as EndMessage).id === 'string'
  );
}

export function isExpiredMessage(msg: unknown): msg is ExpiredMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as ExpiredMessage).type === 'expired'
  );
}

export function isProtocolMessage(msg: unknown): msg is ProtocolMessage {
  return (
    isRegisterMessage(msg) ||
    isRegisteredMessage(msg) ||
    isRequestMessage(msg) ||
    isResponseMessage(msg) ||
    isDataMessage(msg) ||
    isEndMessage(msg) ||
    isExpiredMessage(msg)
  );
}

// ============================================================================
// Serialization / Deserialization
// ============================================================================

/**
 * Serialize a protocol message to JSON string
 */
export function serializeMessage(msg: ProtocolMessage): string {
  return JSON.stringify(msg);
}

/**
 * Deserialize a JSON string to a protocol message
 * Returns null if the message is invalid
 */
export function deserializeMessage(data: string): ProtocolMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (isProtocolMessage(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Message Factories
// ============================================================================

export function createRegisterMessage(path: string, expiresAt: number, password?: string): RegisterMessage {
  const msg: RegisterMessage = { type: 'register', path, expiresAt };
  if (password) {
    msg.password = password;
  }
  return msg;
}

export function createRegisteredMessage(sessionId: string, url: string): RegisteredMessage {
  return { type: 'registered', sessionId, url };
}

export function createRequestMessage(id: string, method: string, path: string): RequestMessage {
  return { type: 'request', id, method, path };
}

export function createResponseMessage(
  id: string,
  status: number,
  headers: Record<string, string>
): ResponseMessage {
  return { type: 'response', id, status, headers };
}

export function createDataMessage(id: string, chunk: string): DataMessage {
  return { type: 'data', id, chunk };
}

export function createEndMessage(id: string): EndMessage {
  return { type: 'end', id };
}

export function createExpiredMessage(): ExpiredMessage {
  return { type: 'expired' };
}
