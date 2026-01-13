package main

import (
	"sync"
	"testing"
	"testing/quick"
	"time"
)

// ============================================================================
// Property Tests
// ============================================================================

// Feature: fwdcast, Property 4: Session ID Uniqueness
// Validates: Requirements 2.1
// For any number of concurrent session creations, all generated session IDs
// should be unique (no collisions).
func TestProperty4_SessionIDUniqueness(t *testing.T) {
	config := &quick.Config{
		MaxCount: 100,
	}

	f := func(numSessions uint8) bool {
		// Limit to reasonable number to avoid test timeout
		count := int(numSessions%50) + 1

		store := NewSessionStore("relay.example.com")
		ids := make(map[string]bool)
		var mu sync.Mutex
		var wg sync.WaitGroup

		expiresAt := time.Now().Add(30 * time.Minute)

		// Create sessions concurrently
		for i := 0; i < count; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				session, err := store.CreateSession(nil, expiresAt)
				if err != nil {
					return
				}

				mu.Lock()
				if ids[session.ID] {
					mu.Unlock()
					t.Errorf("Duplicate session ID found: %s", session.ID)
					return
				}
				ids[session.ID] = true
				mu.Unlock()
			}()
		}

		wg.Wait()

		// Verify all IDs are unique
		mu.Lock()
		uniqueCount := len(ids)
		mu.Unlock()

		return uniqueCount == count
	}

	if err := quick.Check(f, config); err != nil {
		t.Errorf("Property 4 failed: %v", err)
	}
}


// Feature: fwdcast, Property 5: Session URL Validity
// Validates: Requirements 2.5
// For any created session, the returned URL should be a valid URL containing
// the session ID and pointing to the relay server.
func TestProperty5_SessionURLValidity(t *testing.T) {
	config := &quick.Config{
		MaxCount: 100,
	}

	f := func(hostSuffix uint8) bool {
		// Generate various host names
		hosts := []string{
			"relay.example.com",
			"fwdcast.io",
			"localhost:8080",
			"192.168.1.1:8080",
		}
		host := hosts[int(hostSuffix)%len(hosts)]

		store := NewSessionStore(host)
		expiresAt := time.Now().Add(30 * time.Minute)

		session, err := store.CreateSession(nil, expiresAt)
		if err != nil {
			return false
		}

		url := store.GenerateURL(session.ID)

		// Verify URL format: {base}/{session-id}/
		// When PUBLIC_BASE_URL is not set, defaults to http://{host}
		expectedPrefix := "http://" + host + "/"
		expectedSuffix := session.ID + "/"

		// Check URL starts with http://{host}/ (default when PUBLIC_BASE_URL not set)
		if len(url) < len(expectedPrefix) {
			t.Errorf("URL too short: %s", url)
			return false
		}
		if url[:len(expectedPrefix)] != expectedPrefix {
			t.Errorf("URL doesn't start with expected prefix. Got: %s, Expected prefix: %s", url, expectedPrefix)
			return false
		}

		// Check URL contains session ID
		if !containsString(url, session.ID) {
			t.Errorf("URL doesn't contain session ID. URL: %s, SessionID: %s", url, session.ID)
			return false
		}

		// Check URL ends with session-id/
		if len(url) < len(expectedSuffix) || url[len(url)-len(expectedSuffix):] != expectedSuffix {
			t.Errorf("URL doesn't end with session ID and slash. URL: %s", url)
			return false
		}

		return true
	}

	if err := quick.Check(f, config); err != nil {
		t.Errorf("Property 5 failed: %v", err)
	}
}

// Helper function to check if a string contains a substring
func containsString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}


// Feature: fwdcast, Property 6: Session Termination on Disconnect
// Validates: Requirements 2.6, 4.5
// For any active session, when the CLI WebSocket disconnects, the session
// should immediately become unavailable and return nil for all subsequent requests.
func TestProperty6_SessionTerminationOnDisconnect(t *testing.T) {
	config := &quick.Config{
		MaxCount: 100,
	}

	f := func(numSessions uint8) bool {
		// Create a reasonable number of sessions
		count := int(numSessions%20) + 1

		store := NewSessionStore("relay.example.com")
		expiresAt := time.Now().Add(30 * time.Minute)

		// Create sessions and store their IDs
		sessionIDs := make([]string, 0, count)
		for i := 0; i < count; i++ {
			session, err := store.CreateSession(nil, expiresAt)
			if err != nil {
				return false
			}
			sessionIDs = append(sessionIDs, session.ID)
		}

		// Verify all sessions exist
		for _, id := range sessionIDs {
			if store.GetSession(id) == nil {
				t.Errorf("Session should exist before removal: %s", id)
				return false
			}
		}

		// Simulate disconnect by removing sessions
		for _, id := range sessionIDs {
			store.RemoveSession(id)
		}

		// Verify all sessions are unavailable after removal
		for _, id := range sessionIDs {
			if store.GetSession(id) != nil {
				t.Errorf("Session should be unavailable after disconnect: %s", id)
				return false
			}
			if store.SessionExists(id) {
				t.Errorf("Session should not exist after disconnect: %s", id)
				return false
			}
		}

		// Verify session count is 0
		if store.SessionCount() != 0 {
			t.Errorf("Session count should be 0 after all disconnects, got: %d", store.SessionCount())
			return false
		}

		return true
	}

	if err := quick.Check(f, config); err != nil {
		t.Errorf("Property 6 failed: %v", err)
	}
}

// TestProperty6_PendingRequestsCleanup verifies that pending requests are cleaned up on disconnect
// Validates: Requirements 2.6, 4.5
func TestProperty6_PendingRequestsCleanup(t *testing.T) {
	config := &quick.Config{
		MaxCount: 100,
	}

	f := func(numRequests uint8) bool {
		count := int(numRequests%10) + 1

		store := NewSessionStore("relay.example.com")
		expiresAt := time.Now().Add(30 * time.Minute)

		session, err := store.CreateSession(nil, expiresAt)
		if err != nil {
			return false
		}

		// Add pending requests
		doneChannels := make([]chan struct{}, count)
		for i := 0; i < count; i++ {
			done := make(chan struct{})
			doneChannels[i] = done
			req := &PendingRequest{
				ID:   string(rune('a' + i)),
				Done: done,
			}
			if err := store.AddPendingRequest(session.ID, req); err != nil {
				return false
			}
		}

		// Remove session (simulating disconnect)
		store.RemoveSession(session.ID)

		// Verify all Done channels are closed
		for i, done := range doneChannels {
			select {
			case <-done:
				// Channel is closed, as expected
			default:
				t.Errorf("Done channel %d should be closed after session removal", i)
				return false
			}
		}

		return true
	}

	if err := quick.Check(f, config); err != nil {
		t.Errorf("Property 6 (pending requests cleanup) failed: %v", err)
	}
}


// Feature: fwdcast, Property 9: Session Expiry Timing
// Validates: Requirements 4.1
// For any created session, the expiry time should be set to approximately
// 30 minutes (±1 second) from creation time.
func TestProperty9_SessionExpiryTiming(t *testing.T) {
	config := &quick.Config{
		MaxCount: 100,
	}

	f := func(seed uint8) bool {
		store := NewSessionStore("relay.example.com")

		// Record time before and after session creation
		beforeCreate := time.Now()
		expiresAt := beforeCreate.Add(DefaultSessionDuration)

		session, err := store.CreateSession(nil, expiresAt)
		afterCreate := time.Now()

		if err != nil {
			t.Errorf("Failed to create session: %v", err)
			return false
		}

		// Calculate expected expiry bounds (30 minutes ± 1 second tolerance)
		expectedExpiryMin := beforeCreate.Add(DefaultSessionDuration).Add(-1 * time.Second)
		expectedExpiryMax := afterCreate.Add(DefaultSessionDuration).Add(1 * time.Second)

		// Verify expiry is within expected range
		if session.ExpiresAt.Before(expectedExpiryMin) {
			t.Errorf("Session expiry too early. Got: %v, Expected min: %v", session.ExpiresAt, expectedExpiryMin)
			return false
		}

		if session.ExpiresAt.After(expectedExpiryMax) {
			t.Errorf("Session expiry too late. Got: %v, Expected max: %v", session.ExpiresAt, expectedExpiryMax)
			return false
		}

		// Verify the duration is approximately 30 minutes
		duration := session.ExpiresAt.Sub(beforeCreate)
		expectedDuration := DefaultSessionDuration
		tolerance := 2 * time.Second

		if duration < expectedDuration-tolerance || duration > expectedDuration+tolerance {
			t.Errorf("Session duration incorrect. Got: %v, Expected: %v (±%v)", duration, expectedDuration, tolerance)
			return false
		}

		return true
	}

	if err := quick.Check(f, config); err != nil {
		t.Errorf("Property 9 failed: %v", err)
	}
}

// TestProperty9_ExpiryCheckerRemovesExpiredSessions verifies that the expiry checker
// correctly identifies and removes expired sessions
// Validates: Requirements 4.1
func TestProperty9_ExpiryCheckerRemovesExpiredSessions(t *testing.T) {
	store := NewSessionStore("relay.example.com")

	// Create a session that will expire soon (but not immediately)
	// We need to create it with a future expiry, then manually set it to expired
	futureExpiry := time.Now().Add(30 * time.Minute)
	session, err := store.CreateSession(nil, futureExpiry)
	if err != nil {
		t.Fatalf("Failed to create session: %v", err)
	}

	sessionID := session.ID

	// Verify session exists before expiry
	if !store.SessionExists(sessionID) {
		t.Fatalf("Session should exist in store before expiry")
	}

	// Manually set the session to expired
	store.mu.Lock()
	if s := store.sessions[sessionID]; s != nil {
		s.ExpiresAt = time.Now().Add(-1 * time.Second)
	}
	store.mu.Unlock()

	// Manually trigger expiry check
	store.expireSessions()

	// Verify session is removed after expiry check
	if store.SessionExists(sessionID) {
		t.Errorf("Expired session should be removed after expiry check")
	}
}


// Feature: fwdcast, Property 10: Session Expiry Enforcement
// Validates: Requirements 4.2, 7.3
// For any expired session or invalid session ID, requests should return nil
// (which translates to a 404 response in the HTTP handler).
func TestProperty10_SessionExpiryEnforcement(t *testing.T) {
	config := &quick.Config{
		MaxCount: 100,
	}

	f := func(numSessions uint8, invalidIDSeed uint8) bool {
		count := int(numSessions%10) + 1
		store := NewSessionStore("relay.example.com")

		// Create sessions with future expiry
		sessionIDs := make([]string, 0, count)
		for i := 0; i < count; i++ {
			expiresAt := time.Now().Add(30 * time.Minute)
			session, err := store.CreateSession(nil, expiresAt)
			if err != nil {
				return false
			}
			sessionIDs = append(sessionIDs, session.ID)
		}

		// Test 1: Valid sessions should be accessible
		for _, id := range sessionIDs {
			if store.GetSession(id) == nil {
				t.Errorf("Valid session should be accessible: %s", id)
				return false
			}
		}

		// Test 2: Expire all sessions by setting their expiry to the past
		store.mu.Lock()
		for _, id := range sessionIDs {
			if s := store.sessions[id]; s != nil {
				s.ExpiresAt = time.Now().Add(-1 * time.Second)
			}
		}
		store.mu.Unlock()

		// Test 3: Expired sessions should return nil (404)
		for _, id := range sessionIDs {
			if store.GetSession(id) != nil {
				t.Errorf("Expired session should return nil: %s", id)
				return false
			}
		}

		// Test 4: Invalid session IDs should return nil (404)
		invalidIDs := []string{
			"invalid123",
			"nonexistent",
			string([]byte{invalidIDSeed, invalidIDSeed + 1, invalidIDSeed + 2}),
			"",
		}
		for _, id := range invalidIDs {
			if store.GetSession(id) != nil {
				t.Errorf("Invalid session ID should return nil: %s", id)
				return false
			}
		}

		return true
	}

	if err := quick.Check(f, config); err != nil {
		t.Errorf("Property 10 failed: %v", err)
	}
}

// TestProperty10_ExpiredSessionsRemovedFromStore verifies that expired sessions
// are properly removed from the store when accessed
// Validates: Requirements 4.2, 7.3
func TestProperty10_ExpiredSessionsRemovedFromStore(t *testing.T) {
	config := &quick.Config{
		MaxCount: 100,
	}

	f := func(seed uint8) bool {
		store := NewSessionStore("relay.example.com")

		// Create a session with future expiry
		expiresAt := time.Now().Add(30 * time.Minute)
		session, err := store.CreateSession(nil, expiresAt)
		if err != nil {
			return false
		}

		sessionID := session.ID

		// Verify session exists
		if !store.SessionExists(sessionID) {
			t.Errorf("Session should exist initially")
			return false
		}

		// Expire the session
		store.mu.Lock()
		if s := store.sessions[sessionID]; s != nil {
			s.ExpiresAt = time.Now().Add(-1 * time.Second)
		}
		store.mu.Unlock()

		// Access the session (this should trigger removal)
		result := store.GetSession(sessionID)
		if result != nil {
			t.Errorf("GetSession should return nil for expired session")
			return false
		}

		// Verify session is removed from store
		if store.SessionExists(sessionID) {
			t.Errorf("Expired session should be removed from store after access")
			return false
		}

		return true
	}

	if err := quick.Check(f, config); err != nil {
		t.Errorf("Property 10 (expired sessions removed) failed: %v", err)
	}
}


// Feature: fwdcast, Property 11: Viewer Count Management
// Validates: Requirements 4.3, 4.4
// For any session, the viewer count should accurately reflect the number of
// connected viewers, never exceed the maximum (3), and correctly decrement
// when viewers disconnect.
func TestProperty11_ViewerCountManagement(t *testing.T) {
	config := &quick.Config{
		MaxCount: 100,
	}

	f := func(operations uint8) bool {
		store := NewSessionStore("relay.example.com")
		expiresAt := time.Now().Add(30 * time.Minute)

		session, err := store.CreateSession(nil, expiresAt)
		if err != nil {
			return false
		}

		sessionID := session.ID

		// Verify initial viewer count is 0
		if count := store.GetViewerCount(sessionID); count != 0 {
			t.Errorf("Initial viewer count should be 0, got: %d", count)
			return false
		}

		// Test incrementing viewers up to max (3)
		for i := 0; i < 3; i++ {
			err := store.IncrementViewers(sessionID)
			if err != nil {
				t.Errorf("Should be able to add viewer %d, got error: %v", i+1, err)
				return false
			}

			expectedCount := i + 1
			if count := store.GetViewerCount(sessionID); count != expectedCount {
				t.Errorf("Viewer count should be %d after increment, got: %d", expectedCount, count)
				return false
			}
		}

		// Test that 4th viewer is rejected (max 3)
		err = store.IncrementViewers(sessionID)
		if err != ErrMaxViewersReached {
			t.Errorf("Should reject 4th viewer with ErrMaxViewersReached, got: %v", err)
			return false
		}

		// Verify count is still 3
		if count := store.GetViewerCount(sessionID); count != 3 {
			t.Errorf("Viewer count should still be 3 after rejected increment, got: %d", count)
			return false
		}

		// Test decrementing viewers
		for i := 3; i > 0; i-- {
			store.DecrementViewers(sessionID)
			expectedCount := i - 1
			if count := store.GetViewerCount(sessionID); count != expectedCount {
				t.Errorf("Viewer count should be %d after decrement, got: %d", expectedCount, count)
				return false
			}
		}

		// Test that decrementing below 0 doesn't go negative
		store.DecrementViewers(sessionID)
		if count := store.GetViewerCount(sessionID); count != 0 {
			t.Errorf("Viewer count should not go below 0, got: %d", count)
			return false
		}

		return true
	}

	if err := quick.Check(f, config); err != nil {
		t.Errorf("Property 11 failed: %v", err)
	}
}

// TestProperty11_ViewerCountConcurrency tests concurrent viewer operations
// Validates: Requirements 4.3, 4.4
func TestProperty11_ViewerCountConcurrency(t *testing.T) {
	config := &quick.Config{
		MaxCount: 100,
	}

	f := func(numOps uint8) bool {
		store := NewSessionStore("relay.example.com")
		expiresAt := time.Now().Add(30 * time.Minute)

		session, err := store.CreateSession(nil, expiresAt)
		if err != nil {
			return false
		}

		sessionID := session.ID
		numOperations := int(numOps%20) + 5

		var wg sync.WaitGroup
		successCount := 0
		var mu sync.Mutex

		// Try to add many viewers concurrently
		for i := 0; i < numOperations; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				err := store.IncrementViewers(sessionID)
				if err == nil {
					mu.Lock()
					successCount++
					mu.Unlock()
				}
			}()
		}

		wg.Wait()

		// Verify that exactly MaxViewers (3) succeeded
		if successCount != 3 {
			t.Errorf("Exactly 3 viewers should succeed, got: %d", successCount)
			return false
		}

		// Verify final count is 3
		if count := store.GetViewerCount(sessionID); count != 3 {
			t.Errorf("Final viewer count should be 3, got: %d", count)
			return false
		}

		return true
	}

	if err := quick.Check(f, config); err != nil {
		t.Errorf("Property 11 (concurrency) failed: %v", err)
	}
}

// TestProperty11_ViewerCountAfterDisconnect tests that viewer count correctly
// decrements when viewers disconnect
// Validates: Requirements 4.4
func TestProperty11_ViewerCountAfterDisconnect(t *testing.T) {
	config := &quick.Config{
		MaxCount: 100,
	}

	f := func(disconnectPattern uint8) bool {
		store := NewSessionStore("relay.example.com")
		expiresAt := time.Now().Add(30 * time.Minute)

		session, err := store.CreateSession(nil, expiresAt)
		if err != nil {
			return false
		}

		sessionID := session.ID

		// Add 3 viewers
		for i := 0; i < 3; i++ {
			if err := store.IncrementViewers(sessionID); err != nil {
				return false
			}
		}

		// Disconnect viewers based on pattern
		disconnects := int(disconnectPattern%4) // 0-3 disconnects
		for i := 0; i < disconnects; i++ {
			store.DecrementViewers(sessionID)
		}

		expectedCount := 3 - disconnects
		if count := store.GetViewerCount(sessionID); count != expectedCount {
			t.Errorf("Viewer count should be %d after %d disconnects, got: %d", expectedCount, disconnects, count)
			return false
		}

		// After disconnects, should be able to add viewers again
		if disconnects > 0 {
			err := store.IncrementViewers(sessionID)
			if err != nil {
				t.Errorf("Should be able to add viewer after disconnect, got error: %v", err)
				return false
			}
		}

		return true
	}

	if err := quick.Check(f, config); err != nil {
		t.Errorf("Property 11 (disconnect) failed: %v", err)
	}
}
