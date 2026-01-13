# fwdcast Relay Server Dockerfile
# Multi-stage build for minimal image size
# Requirements: 2.1

# ============================================================================
# Stage 1: Build
# ============================================================================
FROM golang:1.21-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates

# Set working directory
WORKDIR /app

# Copy go mod files first for better caching
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY *.go ./

# Build the binary
# CGO_ENABLED=0 for static binary
# -ldflags="-s -w" to strip debug info and reduce size
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-s -w" \
    -o fwdcast-relay .

# ============================================================================
# Stage 2: Runtime
# ============================================================================
FROM scratch

# Copy CA certificates for HTTPS (if needed)
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

# Copy the binary
COPY --from=builder /app/fwdcast-relay /fwdcast-relay

# Expose port 8080
EXPOSE 8080

# Set environment variables
ENV RELAY_HOST=localhost:8080

# Run the relay server
ENTRYPOINT ["/fwdcast-relay"]
