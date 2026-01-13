package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/bcrypt"
)

// ============================================================================
// Constants
// ============================================================================

const (
	// RequestTimeout is the maximum time to wait for a CLI response
	RequestTimeout = 30 * time.Second
)

// ============================================================================
// WebSocket Upgrader
// ============================================================================

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for CLI connections
	},
	HandshakeTimeout: 10 * time.Second,
}

// ============================================================================
// Handlers
// ============================================================================

// Handlers contains all HTTP and WebSocket handlers for the relay server
type Handlers struct {
	store *SessionStore
}

// NewHandlers creates a new Handlers instance
func NewHandlers(store *SessionStore) *Handlers {
	return &Handlers{store: store}
}

// ============================================================================
// Task 10.1: WebSocket Handler for CLI Connections
// Requirements: 2.1, 5.1, 5.2
// ============================================================================

// HandleWebSocket handles WebSocket connections from CLI clients
// - Accepts WebSocket upgrade on /ws endpoint
// - Handles register message, creates session, returns URL
// - Forwards incoming HTTP requests as request messages
func (h *Handlers) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Upgrade HTTP connection to WebSocket
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	// Read the first message - should be a register message
	_, msgBytes, err := conn.ReadMessage()
	if err != nil {
		log.Printf("Failed to read register message: %v", err)
		conn.Close()
		return
	}

	// Parse the message
	msg, err := DeserializeMessage(msgBytes)
	if err != nil {
		log.Printf("Failed to parse register message: %v", err)
		conn.Close()
		return
	}

	// Verify it's a register message
	registerMsg, ok := msg.(*RegisterMessage)
	if !ok {
		log.Printf("Expected register message, got: %T", msg)
		conn.Close()
		return
	}

	// Calculate expiry time from the provided timestamp
	expiresAt := time.Unix(registerMsg.ExpiresAt, 0)

	log.Printf("Session registered: hasPassword=%v, expiresIn=%v", registerMsg.Password != "", time.Until(expiresAt).Round(time.Minute))

	// Create a new session with password if provided
	session, err := h.store.CreateSessionWithPassword(conn, expiresAt, registerMsg.Password)
	if err != nil {
		log.Printf("Failed to create session: %v", err)
		conn.Close()
		return
	}

	// Generate the public URL
	url := h.store.GenerateURL(session.ID)

	// Send registered response
	registeredMsg := NewRegisteredMessage(session.ID, url)
	respBytes, err := SerializeMessage(registeredMsg)
	if err != nil {
		log.Printf("Failed to serialize registered message: %v", err)
		h.store.RemoveSession(session.ID)
		conn.Close()
		return
	}

	if err := conn.WriteMessage(websocket.TextMessage, respBytes); err != nil {
		log.Printf("Failed to send registered message: %v", err)
		h.store.RemoveSession(session.ID)
		conn.Close()
		return
	}

	log.Printf("Session active, URL provided")

	// Start listening for messages from CLI (response, data, end messages)
	go h.handleCLIMessages(session)
}

// handleCLIMessages listens for messages from the CLI and routes them appropriately
func (h *Handlers) handleCLIMessages(session *Session) {
	defer func() {
		log.Printf("Session ended")
		h.store.RemoveSession(session.ID)
	}()

	for {
		_, msgBytes, err := session.WebSocket.ReadMessage()
		if err != nil {
			// Connection closed or error
			return
		}

		msg, err := DeserializeMessage(msgBytes)
		if err != nil {
			log.Printf("Failed to parse CLI message: %v", err)
			continue
		}

		switch m := msg.(type) {
		case *ResponseMessage:
			h.handleResponseMessage(session, m)
		case *DataMessage:
			h.handleDataMessage(session, m)
		case *EndMessage:
			h.handleEndMessage(session, m)
		default:
			log.Printf("Unexpected message type from CLI: %T", msg)
		}
	}
}


// ============================================================================
// Task 10.2: HTTP Handler for Viewer Requests
// Requirements: 3.1, 4.3, 7.3
// ============================================================================

// HandleViewerRequest handles HTTP requests from viewers
// - Parses session ID from URL path
// - Looks up session, returns 404 if not found
// - Checks password authentication if required
// - Checks viewer limit, returns 503 if exceeded
// - Forwards request to CLI via tunnel
func (h *Handlers) HandleViewerRequest(w http.ResponseWriter, r *http.Request) {
	// Parse session ID from URL path
	// URL format: /{session-id}/path/to/file
	path := strings.TrimPrefix(r.URL.Path, "/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) == 0 || parts[0] == "" {
		h.send404(w, "Invalid URL")
		return
	}

	sessionID := parts[0]
	resourcePath := "/"
	if len(parts) > 1 {
		resourcePath = "/" + parts[1]
	}

	// Look up session
	session := h.store.GetSession(sessionID)
	if session == nil {
		h.send404(w, "Session not found or expired")
		return
	}

	// Check if session has expired
	if session.IsExpired() {
		h.store.RemoveSession(sessionID)
		h.send404(w, "Session has expired")
		return
	}

	// Check password authentication if session is password protected
	if len(session.PasswordHash) > 0 {
		// Check for __auth__ path - serve login page or handle auth
		if strings.HasPrefix(resourcePath, "/__auth__") {
			h.handleAuth(w, r, session, resourcePath)
			return
		}

		// Check for auth cookie
		cookie, err := r.Cookie("fwdcast_auth_" + sessionID)
		if err != nil || bcrypt.CompareHashAndPassword(session.PasswordHash, []byte(cookie.Value)) != nil {
			// Redirect to auth page - use the current path as redirect target
			currentPath := "/" + sessionID + "/"
			if resourcePath != "/" {
				currentPath = "/" + sessionID + resourcePath
			}
			redirectURL := fmt.Sprintf("/%s/__auth__?redirect=%s", sessionID, currentPath)
			http.Redirect(w, r, redirectURL, http.StatusFound)
			return
		}
	}

	// Check viewer limit
	if err := h.store.IncrementViewers(sessionID); err != nil {
		if err == ErrMaxViewersReached {
			h.send503(w, "Too many viewers. Please try again later.")
			return
		}
		h.send404(w, "Session not found")
		return
	}

	// Decrement viewer count when done
	defer h.store.DecrementViewers(sessionID)

	// Generate unique request ID
	reqID, err := generateRequestID()
	if err != nil {
		log.Printf("Failed to generate request ID: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// Create pending request
	pendingReq := &PendingRequest{
		ID:             reqID,
		ResponseWriter: w,
		Done:           make(chan struct{}),
	}

	// Add to session's pending requests
	if err := h.store.AddPendingRequest(sessionID, pendingReq); err != nil {
		h.send404(w, "Session not found")
		return
	}
	defer h.store.RemovePendingRequest(sessionID, reqID)

	// Forward request to CLI
	requestMsg := NewRequestMessage(reqID, r.Method, resourcePath)
	msgBytes, err := SerializeMessage(requestMsg)
	if err != nil {
		log.Printf("Failed to serialize request message: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	session.mu.Lock()
	err = session.WebSocket.WriteMessage(websocket.TextMessage, msgBytes)
	session.mu.Unlock()

	if err != nil {
		log.Printf("Failed to forward request to CLI: %v", err)
		h.send504(w, "CLI not responding")
		return
	}

	// Wait for response with timeout
	select {
	case <-pendingReq.Done:
		// Response completed
	case <-time.After(RequestTimeout):
		h.send504(w, "Request timed out")
	}
}

// generateRequestID creates a unique request ID
func generateRequestID() (string, error) {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// send404 sends a 404 response with a friendly HTML message
// Requirement: 7.3
func (h *Handlers) send404(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.WriteHeader(http.StatusNotFound)
	html := `<!DOCTYPE html>
<html>
<head>
  <title>404 Not Found - fwdcast</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px 20px; background: #f5f5f5; margin: 0; }
    .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #e74c3c; margin-bottom: 20px; }
    p { color: #333; line-height: 1.6; }
    .hint { color: #666; font-size: 14px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔍 404 Not Found</h1>
    <p>` + message + `</p>
    <p class="hint">This fwdcast session may have expired or never existed.<br>Sessions automatically expire after 30 minutes.</p>
  </div>
</body>
</html>`
	w.Write([]byte(html))
}

// send503 sends a 503 response for viewer limit exceeded
// Requirement: 7.3
func (h *Handlers) send503(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Retry-After", "30")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.WriteHeader(http.StatusServiceUnavailable)
	html := `<!DOCTYPE html>
<html>
<head>
  <title>503 Too Many Viewers - fwdcast</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px 20px; background: #f5f5f5; margin: 0; }
    .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #f39c12; margin-bottom: 20px; }
    p { color: #333; line-height: 1.6; }
    .hint { color: #666; font-size: 14px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>👥 503 Too Many Viewers</h1>
    <p>` + message + `</p>
    <p class="hint">This session has reached its maximum viewer limit (3).<br>Please try again in a few moments.</p>
  </div>
</body>
</html>`
	w.Write([]byte(html))
}

// send504 sends a 504 response for CLI timeout
// Requirement: 7.3
func (h *Handlers) send504(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.WriteHeader(http.StatusGatewayTimeout)
	html := `<!DOCTYPE html>
<html>
<head>
  <title>504 Gateway Timeout - fwdcast</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px 20px; background: #f5f5f5; margin: 0; }
    .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #9b59b6; margin-bottom: 20px; }
    p { color: #333; line-height: 1.6; }
    .hint { color: #666; font-size: 14px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>⏱️ 504 Gateway Timeout</h1>
    <p>` + message + `</p>
    <p class="hint">The file sharer's computer did not respond in time.<br>They may have a slow connection or the file may be very large.</p>
  </div>
</body>
</html>`
	w.Write([]byte(html))
}

// handleAuth handles password authentication for protected sessions
func (h *Handlers) handleAuth(w http.ResponseWriter, r *http.Request, session *Session, resourcePath string) {
	redirect := r.URL.Query().Get("redirect")
	if redirect == "" || redirect == "/" + session.ID + "/__auth__" {
		redirect = "/" + session.ID + "/"
	}

	// Handle POST - verify password
	if r.Method == "POST" {
		r.ParseForm()
		password := r.FormValue("password")

		// Rate limiting: check if too many failed attempts
		session.mu.Lock()
		if session.FailedAttempts >= 5 {
			timeSinceLastAttempt := time.Since(session.LastAttemptTime)
			if timeSinceLastAttempt < 30*time.Second {
				session.mu.Unlock()
				h.sendRateLimitPage(w, session.ID, redirect, 30-int(timeSinceLastAttempt.Seconds()))
				return
			}
			// Reset after cooldown
			session.FailedAttempts = 0
		}
		session.LastAttemptTime = time.Now()
		session.mu.Unlock()

		if bcrypt.CompareHashAndPassword(session.PasswordHash, []byte(password)) == nil {
			// Reset failed attempts on success
			session.mu.Lock()
			session.FailedAttempts = 0
			session.mu.Unlock()

			// Set auth cookie with the password (will be verified against hash)
			http.SetCookie(w, &http.Cookie{
				Name:     "fwdcast_auth_" + session.ID,
				Value:    password,
				Path:     "/" + session.ID,
				MaxAge:   3600, // 1 hour
				HttpOnly: true,
				Secure:   true,
				SameSite: http.SameSiteLaxMode,
			})
			http.Redirect(w, r, redirect, http.StatusFound)
			return
		}

		// Wrong password - increment failed attempts
		session.mu.Lock()
		session.FailedAttempts++
		session.mu.Unlock()

		h.sendAuthPage(w, session.ID, redirect, true)
		return
	}

	// GET - show login page
	h.sendAuthPage(w, session.ID, redirect, false)
}

// sendAuthPage renders the password authentication page
func (h *Handlers) sendAuthPage(w http.ResponseWriter, sessionID, redirect string, showError bool) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

	errorHTML := ""
	if showError {
		errorHTML = `<div class="error">Incorrect password. Please try again.</div>`
	}

	html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
  <title>Password Required - fwdcast</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      background: #1e1e1e; 
      margin: 0; 
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container { 
      max-width: 400px; 
      width: 100%%;
      background: #2d2d2d; 
      padding: 40px; 
      border-radius: 8px; 
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      text-align: center;
    }
    .lock-icon {
      font-size: 48px;
      margin-bottom: 20px;
    }
    h1 { 
      color: #cccccc; 
      margin: 0 0 8px 0;
      font-size: 24px;
      font-weight: 500;
    }
    .subtitle {
      color: #858585;
      font-size: 14px;
      margin-bottom: 24px;
    }
    .error {
      background: rgba(231, 76, 60, 0.2);
      border: 1px solid #e74c3c;
      color: #e74c3c;
      padding: 10px 16px;
      border-radius: 4px;
      margin-bottom: 20px;
      font-size: 14px;
    }
    form { text-align: left; }
    label {
      display: block;
      color: #858585;
      font-size: 12px;
      margin-bottom: 6px;
    }
    input[type="password"] {
      width: 100%%;
      padding: 12px;
      border: 1px solid #3c3c3c;
      border-radius: 4px;
      background: #1e1e1e;
      color: #cccccc;
      font-size: 16px;
      margin-bottom: 20px;
    }
    input[type="password"]:focus {
      outline: none;
      border-color: #007acc;
    }
    button {
      width: 100%%;
      padding: 12px;
      background: #007acc;
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 16px;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover {
      background: #005a9e;
    }
    button:active {
      transform: scale(0.98);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="lock-icon">🔒</div>
    <h1>Password Required</h1>
    <p class="subtitle">This share is password protected</p>
    %s
    <form method="POST" action="/%s/__auth__?redirect=%s">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" placeholder="Enter password" autofocus required>
      <button type="submit">Access Files</button>
    </form>
  </div>
</body>
</html>`, errorHTML, sessionID, redirect)

	w.Write([]byte(html))
}

// sendRateLimitPage renders the rate limit page
func (h *Handlers) sendRateLimitPage(w http.ResponseWriter, sessionID, redirect string, secondsRemaining int) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.WriteHeader(http.StatusTooManyRequests)

	html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
  <title>Too Many Attempts - fwdcast</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="%d;url=/%s/__auth__?redirect=%s">
  <style>
    * { box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      background: #1e1e1e; 
      margin: 0; 
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container { 
      max-width: 400px; 
      width: 100%%;
      background: #2d2d2d; 
      padding: 40px; 
      border-radius: 8px; 
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      text-align: center;
    }
    .icon { font-size: 48px; margin-bottom: 20px; }
    h1 { color: #e74c3c; margin: 0 0 8px 0; font-size: 24px; font-weight: 500; }
    .subtitle { color: #858585; font-size: 14px; margin-bottom: 24px; }
    .countdown { color: #cccccc; font-size: 32px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">⏳</div>
    <h1>Too Many Attempts</h1>
    <p class="subtitle">Please wait before trying again</p>
    <p class="countdown" id="countdown">%d</p>
    <p class="subtitle">seconds remaining</p>
  </div>
  <script>
    let seconds = %d;
    const countdown = document.getElementById('countdown');
    setInterval(() => {
      if (seconds > 0) {
        seconds--;
        countdown.textContent = seconds;
      }
    }, 1000);
  </script>
</body>
</html>`, secondsRemaining, sessionID, redirect, secondsRemaining, secondsRemaining)

	w.Write([]byte(html))
}

// ============================================================================
// Task 10.3: Response Streaming
// Requirements: 3.2, 3.3, 3.4
// ============================================================================

// ResponseState tracks the state of a streaming response
type ResponseState struct {
	HeadersSent bool
	Flusher     http.Flusher
	mu          sync.Mutex
}

// responseStates maps request IDs to their response state
var responseStates = struct {
	states map[string]*ResponseState
	mu     sync.RWMutex
}{
	states: make(map[string]*ResponseState),
}

// handleResponseMessage processes response headers from CLI
// Receives response message and writes headers to HTTP response
func (h *Handlers) handleResponseMessage(session *Session, msg *ResponseMessage) {
	pendingReq := h.store.GetPendingRequest(session.ID, msg.ID)
	if pendingReq == nil {
		log.Printf("No pending request for response ID: %s", msg.ID)
		return
	}

	w := pendingReq.ResponseWriter

	// Set headers from CLI response
	for key, value := range msg.Headers {
		w.Header().Set(key, value)
	}

	// Write status code
	w.WriteHeader(msg.Status)

	// Create response state for streaming
	state := &ResponseState{
		HeadersSent: true,
	}
	if flusher, ok := w.(http.Flusher); ok {
		state.Flusher = flusher
	}

	responseStates.mu.Lock()
	responseStates.states[msg.ID] = state
	responseStates.mu.Unlock()
}

// handleDataMessage processes data chunks from CLI
// Streams data directly to HTTP response writer without buffering
func (h *Handlers) handleDataMessage(session *Session, msg *DataMessage) {
	pendingReq := h.store.GetPendingRequest(session.ID, msg.ID)
	if pendingReq == nil {
		log.Printf("No pending request for data ID: %s", msg.ID)
		return
	}

	// Get response state
	responseStates.mu.RLock()
	state := responseStates.states[msg.ID]
	responseStates.mu.RUnlock()

	if state == nil {
		log.Printf("No response state for data ID: %s", msg.ID)
		return
	}

	// Decode base64 chunk
	chunk, err := base64.StdEncoding.DecodeString(msg.Chunk)
	if err != nil {
		log.Printf("Failed to decode data chunk: %v", err)
		return
	}

	// Write chunk to response
	w := pendingReq.ResponseWriter
	state.mu.Lock()
	_, err = w.Write(chunk)
	if state.Flusher != nil {
		state.Flusher.Flush()
	}
	state.mu.Unlock()

	if err != nil {
		log.Printf("Failed to write data chunk: %v", err)
	}
}

// handleEndMessage processes end-of-response from CLI
// Signals that the response is complete
func (h *Handlers) handleEndMessage(session *Session, msg *EndMessage) {
	pendingReq := h.store.GetPendingRequest(session.ID, msg.ID)
	if pendingReq == nil {
		log.Printf("No pending request for end ID: %s", msg.ID)
		return
	}

	// Clean up response state
	responseStates.mu.Lock()
	delete(responseStates.states, msg.ID)
	responseStates.mu.Unlock()

	// Signal that the request is complete
	close(pendingReq.Done)
}
