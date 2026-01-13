package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
)

func main() {
	port := ":8080"
	host := os.Getenv("RELAY_HOST")
	if host == "" {
		host = "localhost:8080"
	}

	// Create session store
	store := NewSessionStore(host)
	store.StartExpiryChecker()
	defer store.StopExpiryChecker()

	// Create handlers
	handlers := NewHandlers(store)

	// Register routes
	http.HandleFunc("/ws", handlers.HandleWebSocket)
	http.HandleFunc("/viewer-ws/", handlers.HandleViewerWebSocket)
	http.HandleFunc("/", handlers.HandleViewerRequest)

	fmt.Printf("fwdcast Relay Server starting on %s\n", port)
	fmt.Printf("Public URL host: %s\n", host)
	log.Fatal(http.ListenAndServe(port, nil))
}
