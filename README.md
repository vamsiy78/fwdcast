# fwdcast

**Temporary file sharing** - Stream local files as a public website without uploading anything.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)

## What is fwdcast?

fwdcast lets you instantly share files from your computer via a public URL. Unlike traditional file sharing services, your files are **never uploaded** - they stream directly from your machine through a relay server.

```bash
npx fwdcast
```

That's it. You get a URL, share it, and people can browse and download your files.

## Features

| Feature | Description |
|---------|-------------|
| 🚀 **Instant sharing** | Get a public URL in seconds |
| 📁 **No upload** | Files stream directly from your machine |
| 🎨 **VS Code-style UI** | Beautiful dark theme file browser |
| 👁️ **File preview** | View text, code, and images in-browser |
| 📥 **ZIP download** | Download entire directories with one click |
| ⏱️ **Auto-expires** | Sessions expire after 30 minutes |
| 🔄 **Live updates** | File changes reflect immediately on refresh |
| 🔒 **Secure** | Files only accessible while CLI is running |

## Installation

### Using npx (no install required)
```bash
npx fwdcast
```

### Global install
```bash
npm install -g fwdcast
fwdcast
```

## Usage

### Share current directory
```bash
fwdcast
```

### Share a specific folder
```bash
fwdcast /path/to/folder
```

### Use custom relay server
```bash
fwdcast --relay wss://your-relay.com/ws
```

## How It Works

```
┌─────────────┐     WebSocket      ┌──────────────┐      HTTPS       ┌─────────────┐
│   Your PC   │◄──────────────────►│ Relay Server │◄────────────────►│   Viewers   │
│  (fwdcast)  │   file streaming   │              │   file requests  │  (browser)  │
└─────────────┘                    └──────────────┘                  └─────────────┘
```

1. **You run fwdcast** - CLI scans your directory and connects to relay
2. **Get a URL** - Relay assigns a unique session URL
3. **Share the URL** - Anyone with the link can browse your files
4. **Files stream on-demand** - When someone requests a file, it streams from your machine
5. **Session ends** - When you stop the CLI or after 30 minutes, files become inaccessible

## Current Capabilities

### ✅ What fwdcast CAN do

- Share any directory from your local machine
- Serve files of any type (text, images, videos, binaries, etc.)
- Display directory listings with a modern UI
- Preview text files and images in-browser
- Download individual files or entire directories as ZIP
- Handle multiple concurrent viewers (up to 3)
- Automatically detect and display file types with icons
- Navigate through subdirectories
- Reflect file content changes on browser refresh

### ❌ What fwdcast CANNOT do (yet)

- **No authentication** - Anyone with the URL can access files
- **No selective sharing** - Shares entire directory (use a subfolder to limit)
- **No upload** - Viewers cannot upload files to you
- **No real-time sync** - Browser doesn't auto-refresh when files change
- **No persistent URLs** - Each session gets a new random URL
- **No file editing** - Read-only access for viewers
- **No bandwidth control** - No throttling or rate limiting
- **No analytics** - No tracking of who accessed what

## Limits

| Limit | Value |
|-------|-------|
| Maximum total size | 500 MB |
| Maximum file size | 100 MB per file |
| Session duration | 30 minutes |
| Concurrent viewers | 3 |

## Project Structure

```
fwdcast/
├── cli/                    # Node.js CLI application
│   ├── src/
│   │   ├── index.ts        # CLI entry point
│   │   ├── scanner.ts      # Directory scanning
│   │   ├── validator.ts    # Size validation
│   │   ├── tunnel-client.ts # WebSocket client
│   │   ├── protocol.ts     # Message protocol
│   │   └── html-generator.ts # UI generation
│   └── package.json
│
└── relay/                  # Go relay server
    ├── main.go             # Server entry point
    ├── handlers.go         # HTTP/WebSocket handlers
    ├── session.go          # Session management
    ├── protocol.go         # Message protocol
    └── deploy/             # Deployment scripts
```

## Self-Hosting the Relay Server

You can run your own relay server for privacy or to remove limits.

### Prerequisites
- Go 1.21+
- A server with public IP
- (Optional) Domain with SSL certificate

### Quick Start

```bash
cd relay
go build -o fwdcast-relay
./fwdcast-relay
```

The relay runs on port 8080 by default.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RELAY_HOST` | Hostname for generated URLs | `localhost:8080` |
| `PUBLIC_BASE_URL` | Full base URL (for HTTPS) | `http://{RELAY_HOST}` |

### Production Deployment with Caddy

See [relay/deploy/README.md](relay/deploy/README.md) for full deployment instructions including:
- Systemd service setup
- Caddy reverse proxy with automatic HTTPS
- GCP/AWS deployment guides

## Development

### CLI Development

```bash
cd cli
npm install
npm run dev         # Run in development mode
npm test            # Run tests
npm run build       # Build for production
```

### Relay Development

```bash
cd relay
go run .            # Run server
go test ./...       # Run tests
go build            # Build binary
```

## Security Considerations

- **Temporary by design** - Sessions auto-expire, reducing exposure window
- **No persistence** - Nothing is stored on the relay server
- **Path traversal protection** - CLI validates all file paths
- **Session isolation** - Each session has a unique random ID

**⚠️ Warning**: Anyone with your session URL can access your shared files. Only share URLs with trusted parties.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

Built with:
- [Commander.js](https://github.com/tj/commander.js) - CLI framework
- [ws](https://github.com/websockets/ws) - WebSocket client
- [Gorilla WebSocket](https://github.com/gorilla/websocket) - Go WebSocket server
- [Archiver](https://github.com/archiverjs/node-archiver) - ZIP creation
