package main

import (
	"encoding/json"
	"errors"
)

// ============================================================================
// Message Types
// ============================================================================

// MessageType represents the type field in protocol messages
type MessageType string

const (
	TypeRegister   MessageType = "register"
	TypeRegistered MessageType = "registered"
	TypeRequest    MessageType = "request"
	TypeResponse   MessageType = "response"
	TypeData       MessageType = "data"
	TypeEnd        MessageType = "end"
	TypeExpired    MessageType = "expired"
)

// BaseMessage contains the common type field
type BaseMessage struct {
	Type MessageType `json:"type"`
}

// RegisterMessage - CLI → Relay: Registration message
// Sent when CLI connects to register a new session
// Requirements: 5.1
type RegisterMessage struct {
	Type      MessageType `json:"type"`
	Path      string      `json:"path"`
	ExpiresAt int64       `json:"expiresAt"` // Unix timestamp
}

// RegisteredMessage - Relay → CLI: Registration response
// Sent after successful session creation
// Requirements: 5.1
type RegisteredMessage struct {
	Type      MessageType `json:"type"`
	SessionID string      `json:"sessionId"`
	URL       string      `json:"url"`
}

// RequestMessage - Relay → CLI: Forward HTTP request
// Sent when a viewer requests a resource
// Requirements: 5.2
type RequestMessage struct {
	Type   MessageType `json:"type"`
	ID     string      `json:"id"`     // Unique request ID
	Method string      `json:"method"` // GET, HEAD
	Path   string      `json:"path"`   // Requested path within share
}

// ResponseMessage - CLI → Relay: Response headers
// Sent to start the response for a request
// Requirements: 5.3
type ResponseMessage struct {
	Type    MessageType       `json:"type"`
	ID      string            `json:"id"`
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
}

// DataMessage - CLI → Relay: Response body chunk
// Sent for each chunk of response data
// Requirements: 5.4
type DataMessage struct {
	Type  MessageType `json:"type"`
	ID    string      `json:"id"`
	Chunk string      `json:"chunk"` // Base64 encoded
}

// EndMessage - CLI → Relay: Response complete
// Sent when response streaming is finished
// Requirements: 5.5
type EndMessage struct {
	Type MessageType `json:"type"`
	ID   string      `json:"id"`
}

// ExpiredMessage - Relay → CLI: Session expired
// Sent when the session has expired
type ExpiredMessage struct {
	Type MessageType `json:"type"`
}

// ============================================================================
// Errors
// ============================================================================

var (
	ErrInvalidMessage     = errors.New("invalid message format")
	ErrUnknownMessageType = errors.New("unknown message type")
	ErrMissingField       = errors.New("missing required field")
)

// ============================================================================
// Serialization / Deserialization
// ============================================================================

// SerializeMessage converts a message to JSON bytes
func SerializeMessage(msg interface{}) ([]byte, error) {
	return json.Marshal(msg)
}

// DeserializeMessage parses JSON bytes into the appropriate message type
func DeserializeMessage(data []byte) (interface{}, error) {
	// First, parse just the type field
	var base BaseMessage
	if err := json.Unmarshal(data, &base); err != nil {
		return nil, ErrInvalidMessage
	}

	// Parse into the specific message type
	switch base.Type {
	case TypeRegister:
		var msg RegisterMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			return nil, ErrInvalidMessage
		}
		if err := ValidateRegisterMessage(&msg); err != nil {
			return nil, err
		}
		return &msg, nil

	case TypeRegistered:
		var msg RegisteredMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			return nil, ErrInvalidMessage
		}
		if err := ValidateRegisteredMessage(&msg); err != nil {
			return nil, err
		}
		return &msg, nil

	case TypeRequest:
		var msg RequestMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			return nil, ErrInvalidMessage
		}
		if err := ValidateRequestMessage(&msg); err != nil {
			return nil, err
		}
		return &msg, nil

	case TypeResponse:
		var msg ResponseMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			return nil, ErrInvalidMessage
		}
		if err := ValidateResponseMessage(&msg); err != nil {
			return nil, err
		}
		return &msg, nil

	case TypeData:
		var msg DataMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			return nil, ErrInvalidMessage
		}
		if err := ValidateDataMessage(&msg); err != nil {
			return nil, err
		}
		return &msg, nil

	case TypeEnd:
		var msg EndMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			return nil, ErrInvalidMessage
		}
		if err := ValidateEndMessage(&msg); err != nil {
			return nil, err
		}
		return &msg, nil

	case TypeExpired:
		var msg ExpiredMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			return nil, ErrInvalidMessage
		}
		return &msg, nil

	default:
		return nil, ErrUnknownMessageType
	}
}

// ============================================================================
// Validation
// ============================================================================

// ValidateRegisterMessage checks that all required fields are present
func ValidateRegisterMessage(msg *RegisterMessage) error {
	if msg.Type != TypeRegister {
		return ErrInvalidMessage
	}
	if msg.Path == "" {
		return ErrMissingField
	}
	if msg.ExpiresAt == 0 {
		return ErrMissingField
	}
	return nil
}

// ValidateRegisteredMessage checks that all required fields are present
func ValidateRegisteredMessage(msg *RegisteredMessage) error {
	if msg.Type != TypeRegistered {
		return ErrInvalidMessage
	}
	if msg.SessionID == "" {
		return ErrMissingField
	}
	if msg.URL == "" {
		return ErrMissingField
	}
	return nil
}

// ValidateRequestMessage checks that all required fields are present
func ValidateRequestMessage(msg *RequestMessage) error {
	if msg.Type != TypeRequest {
		return ErrInvalidMessage
	}
	if msg.ID == "" {
		return ErrMissingField
	}
	if msg.Method == "" {
		return ErrMissingField
	}
	if msg.Path == "" {
		return ErrMissingField
	}
	return nil
}

// ValidateResponseMessage checks that all required fields are present
func ValidateResponseMessage(msg *ResponseMessage) error {
	if msg.Type != TypeResponse {
		return ErrInvalidMessage
	}
	if msg.ID == "" {
		return ErrMissingField
	}
	// Status 0 is technically valid (though unusual)
	if msg.Headers == nil {
		return ErrMissingField
	}
	return nil
}

// ValidateDataMessage checks that all required fields are present
func ValidateDataMessage(msg *DataMessage) error {
	if msg.Type != TypeData {
		return ErrInvalidMessage
	}
	if msg.ID == "" {
		return ErrMissingField
	}
	// Empty chunk is valid (for empty files)
	return nil
}

// ValidateEndMessage checks that all required fields are present
func ValidateEndMessage(msg *EndMessage) error {
	if msg.Type != TypeEnd {
		return ErrInvalidMessage
	}
	if msg.ID == "" {
		return ErrMissingField
	}
	return nil
}

// ============================================================================
// Message Factories
// ============================================================================

// NewRegisterMessage creates a new register message
func NewRegisterMessage(path string, expiresAt int64) *RegisterMessage {
	return &RegisterMessage{
		Type:      TypeRegister,
		Path:      path,
		ExpiresAt: expiresAt,
	}
}

// NewRegisteredMessage creates a new registered message
func NewRegisteredMessage(sessionID, url string) *RegisteredMessage {
	return &RegisteredMessage{
		Type:      TypeRegistered,
		SessionID: sessionID,
		URL:       url,
	}
}

// NewRequestMessage creates a new request message
func NewRequestMessage(id, method, path string) *RequestMessage {
	return &RequestMessage{
		Type:   TypeRequest,
		ID:     id,
		Method: method,
		Path:   path,
	}
}

// NewResponseMessage creates a new response message
func NewResponseMessage(id string, status int, headers map[string]string) *ResponseMessage {
	return &ResponseMessage{
		Type:    TypeResponse,
		ID:      id,
		Status:  status,
		Headers: headers,
	}
}

// NewDataMessage creates a new data message
func NewDataMessage(id, chunk string) *DataMessage {
	return &DataMessage{
		Type:  TypeData,
		ID:    id,
		Chunk: chunk,
	}
}

// NewEndMessage creates a new end message
func NewEndMessage(id string) *EndMessage {
	return &EndMessage{
		Type: TypeEnd,
		ID:   id,
	}
}

// NewExpiredMessage creates a new expired message
func NewExpiredMessage() *ExpiredMessage {
	return &ExpiredMessage{
		Type: TypeExpired,
	}
}
