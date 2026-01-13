package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ============================================================================
// Session Types
// ============================================================================

// PendingRequest represents an HTTP request waiting for a response from the CLI
type PendingRequest struct {
	ID             string
	ResponseWriter http.ResponseWriter
	Done           chan struct{}
}

// Session represents an active CLI connection and its associated state
// Requirements: 2.1, 2.2
type Session struct {
	ID          string
	WebSocket   *websocket.Conn
	ExpiresAt   time.Time
	ViewerCount int
	MaxViewers  int
	PendingReqs map[string]*PendingRequest
	mu          sync.Mutex
}

// SessionStore manages all active sessions in-memory
// Requirements: 2.2, 2.3
type SessionStore struct {
	sessions map[string]*Session
	mu       sync.RWMutex
	host     string // Relay server host for URL generation
	stopCh   chan struct{} // Channel to stop the expiry goroutine
}

// ============================================================================
// Session Store Implementation
// ============================================================================

// NewSessionStore creates a new in-memory session store
func NewSessionStore(host string) *SessionStore {
	return &SessionStore{
		sessions: make(map[string]*Session),
		host:     host,
		stopCh:   make(chan struct{}),
	}
}

// DefaultSessionDuration is the default session expiry duration (30 minutes)
const DefaultSessionDuration = 30 * time.Minute

// ExpiryCheckInterval is how often the expiry goroutine checks for expired sessions
const ExpiryCheckInterval = 10 * time.Second

// StartExpiryChecker starts a background goroutine that periodically checks for
// and removes expired sessions. It sends an expired message to the CLI before closing.
// Requirements: 4.1, 4.2
func (s *SessionStore) StartExpiryChecker() {
	go func() {
		ticker := time.NewTicker(ExpiryCheckInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				s.expireSessions()
			case <-s.stopCh:
				return
			}
		}
	}()
}

// StopExpiryChecker stops the background expiry checker goroutine
func (s *SessionStore) StopExpiryChecker() {
	close(s.stopCh)
}

// expireSessions checks all sessions and removes expired ones
// Sends an expired message to the CLI before closing the WebSocket
// Requirements: 4.1, 4.2
func (s *SessionStore) expireSessions() {
	now := time.Now()
	var expiredIDs []string

	// First pass: identify expired sessions
	s.mu.RLock()
	for id, session := range s.sessions {
		if now.After(session.ExpiresAt) {
			expiredIDs = append(expiredIDs, id)
		}
	}
	s.mu.RUnlock()

	// Second pass: expire each session
	for _, id := range expiredIDs {
		s.ExpireSession(id)
	}
}

// ExpireSession expires a specific session by sending an expired message
// to the CLI and then removing the session
// Requirements: 4.1, 4.2
func (s *SessionStore) ExpireSession(id string) {
	s.mu.Lock()
	session := s.sessions[id]
	s.mu.Unlock()

	if session == nil {
		return
	}

	// Send expired message to CLI before closing
	if session.WebSocket != nil {
		expiredMsg := NewExpiredMessage()
		msgBytes, err := SerializeMessage(expiredMsg)
		if err == nil {
			session.mu.Lock()
			session.WebSocket.WriteMessage(1, msgBytes) // 1 = TextMessage
			session.WebSocket.Close()
			session.mu.Unlock()
		}
	}

	// Remove the session
	s.RemoveSession(id)
}

// IsExpired checks if a session has expired
func (s *Session) IsExpired() bool {
	return time.Now().After(s.ExpiresAt)
}


// generateSessionID creates a unique random session ID
// Uses crypto/rand for cryptographically secure random bytes
// Returns a 12-character hex string (6 bytes = 48 bits of entropy)
func generateSessionID() (string, error) {
	bytes := make([]byte, 6)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// CreateSession creates a new session for a CLI connection
// Requirements: 2.1, 2.2
func (s *SessionStore) CreateSession(ws *websocket.Conn, expiresAt time.Time) (*Session, error) {
	id, err := generateSessionID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate session ID: %w", err)
	}

	session := &Session{
		ID:          id,
		WebSocket:   ws,
		ExpiresAt:   expiresAt,
		ViewerCount: 0,
		MaxViewers:  3,
		PendingReqs: make(map[string]*PendingRequest),
	}

	s.mu.Lock()
	// Check for collision (extremely unlikely but handle it)
	for s.sessions[id] != nil {
		id, err = generateSessionID()
		if err != nil {
			s.mu.Unlock()
			return nil, fmt.Errorf("failed to generate session ID: %w", err)
		}
		session.ID = id
	}
	s.sessions[id] = session
	s.mu.Unlock()

	return session, nil
}

// GetSession retrieves a session by ID
// Returns nil if session doesn't exist or has expired
func (s *SessionStore) GetSession(id string) *Session {
	s.mu.RLock()
	session := s.sessions[id]
	s.mu.RUnlock()

	if session == nil {
		return nil
	}

	// Check if session has expired
	if time.Now().After(session.ExpiresAt) {
		s.RemoveSession(id)
		return nil
	}

	return session
}

// RemoveSession removes a session from the store
// Requirements: 2.6, 4.5
func (s *SessionStore) RemoveSession(id string) {
	s.mu.Lock()
	session := s.sessions[id]
	if session != nil {
		// Clean up pending requests
		session.mu.Lock()
		for _, req := range session.PendingReqs {
			close(req.Done)
		}
		session.PendingReqs = make(map[string]*PendingRequest)
		session.mu.Unlock()

		delete(s.sessions, id)
	}
	s.mu.Unlock()
}

// GenerateURL creates the public URL for a session
// Uses PUBLIC_BASE_URL env var if set, otherwise defaults to http://{host}
// Format: {base-url}/{session-id}/
// Requirements: 2.5
func (s *SessionStore) GenerateURL(sessionID string) string {
	publicBase := os.Getenv("PUBLIC_BASE_URL")
	if publicBase == "" {
		publicBase = "http://" + s.host
	}
	return fmt.Sprintf("%s/%s/", publicBase, sessionID)
}

// IncrementViewers increases the viewer count for a session
// Returns error if max viewers reached (should return 503)
// Requirements: 4.3
func (s *SessionStore) IncrementViewers(id string) error {
	session := s.GetSession(id)
	if session == nil {
		return ErrSessionNotFound
	}

	session.mu.Lock()
	defer session.mu.Unlock()

	if session.ViewerCount >= session.MaxViewers {
		return ErrMaxViewersReached
	}

	session.ViewerCount++
	return nil
}

// DecrementViewers decreases the viewer count for a session
// Requirements: 4.4
func (s *SessionStore) DecrementViewers(id string) {
	session := s.GetSession(id)
	if session == nil {
		return
	}

	session.mu.Lock()
	defer session.mu.Unlock()

	if session.ViewerCount > 0 {
		session.ViewerCount--
	}
}

// GetViewerCount returns the current viewer count for a session
// Returns -1 if session not found
func (s *SessionStore) GetViewerCount(id string) int {
	session := s.GetSession(id)
	if session == nil {
		return -1
	}

	session.mu.Lock()
	defer session.mu.Unlock()
	return session.ViewerCount
}

// Error types for viewer management
var (
	ErrSessionNotFound   = fmt.Errorf("session not found")
	ErrMaxViewersReached = fmt.Errorf("max viewers reached")
)

// AddPendingRequest adds a pending request to a session
func (s *SessionStore) AddPendingRequest(sessionID string, req *PendingRequest) error {
	session := s.GetSession(sessionID)
	if session == nil {
		return fmt.Errorf("session not found")
	}

	session.mu.Lock()
	session.PendingReqs[req.ID] = req
	session.mu.Unlock()

	return nil
}

// GetPendingRequest retrieves a pending request from a session
func (s *SessionStore) GetPendingRequest(sessionID, reqID string) *PendingRequest {
	session := s.GetSession(sessionID)
	if session == nil {
		return nil
	}

	session.mu.Lock()
	req := session.PendingReqs[reqID]
	session.mu.Unlock()

	return req
}

// RemovePendingRequest removes a pending request from a session
func (s *SessionStore) RemovePendingRequest(sessionID, reqID string) {
	session := s.GetSession(sessionID)
	if session == nil {
		return
	}

	session.mu.Lock()
	delete(session.PendingReqs, reqID)
	session.mu.Unlock()
}

// SessionCount returns the number of active sessions (for testing)
func (s *SessionStore) SessionCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.sessions)
}

// SessionExists checks if a session exists (for testing)
func (s *SessionStore) SessionExists(id string) bool {
	s.mu.RLock()
	_, exists := s.sessions[id]
	s.mu.RUnlock()
	return exists
}
