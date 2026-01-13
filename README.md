# fwdcast

**Temporary file sharing** - Stream local files as a public website without uploading anything.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)
![npm](https://img.shields.io/npm/v/fwdcast.svg)

## What is fwdcast?

fwdcast lets you instantly share files from your computer via a public URL. Unlike traditional file sharing services, your files are **never uploaded** - they stream directly from your machine through a relay server.

```bash
npx fwdcast
```

That's it. You get a URL, share it, and people can browse and download your files.

## Features

| Feature | Description |
|---------|-------------|
| **Instant sharing** | Get a public URL in seconds |
| **No upload** | Files stream directly from your machine |
| **VS Code-style UI** | Beautiful dark theme file browser |
| **File preview** | View text, code, and images in-browser |
| **ZIP download** | Download entire directories with one click |
| **Password protection** | Secure your share with a password |
| **QR code** | Easy mobile sharing with terminal QR code (shown by default) |
| **Live stats** | View count and bandwidth in real-time |
| **Custom duration** | Sessions from 1-120 minutes |
| **Exclude files** | Skip .git, node_modules, etc. |

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

### Basic - Share current directory
```bash
fwdcast
```

### Share a specific folder
```bash
fwdcast /path/to/folder
```

### Password protect your share
```bash
fwdcast -p mysecretpassword
```

### Hide QR code (shown by default)
```bash
fwdcast --no-qr
```

### Custom session duration (60 minutes)
```bash
fwdcast -d 60
```

### Exclude additional files/folders
```bash
fwdcast -e .git node_modules dist
```

### Combine options
```bash
fwdcast ~/Documents -p secret123 -d 60
```

## CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --password <pass>` | Require password to access | None |
| `-d, --duration <mins>` | Session duration (1-120) | 30 |
| `-q, --qr` | Show QR code in terminal | true |
| `--no-qr` | Hide QR code | false |
| `-e, --exclude <patterns>` | Exclude files/folders | See below |
| `-r, --relay <url>` | Custom relay server | Public relay |

### Default Excludes
These are always excluded: `.git`, `node_modules`, `.DS_Store`, `__pycache__`, `.env`

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
5. **Session ends** - When you stop the CLI or session expires, files become inaccessible

## Live Stats

While sharing, fwdcast shows real-time statistics:
```
[2 viewers] Total: 15.3 MB | Requests: 42 | 1.2 MB/s
```

## Limits

| Limit | Value |
|-------|-------|
| Maximum total size | 500 MB |
| Maximum file size | 100 MB per file |
| Session duration | 1-120 minutes (default: 30) |
| Concurrent viewers | 3 |

## Current Capabilities

### ✅ What fwdcast CAN do

- Share any directory from your local machine
- Password protect your shared files
- Show QR code for easy mobile access
- Display live viewer count and bandwidth stats
- Exclude specific files/folders from sharing
- Set custom session duration (1-120 minutes)
- Serve files of any type (text, images, videos, binaries, etc.)
- Display directory listings with a modern VS Code-style UI
- Preview text files and images in-browser
- Download individual files or entire directories as ZIP
- Handle multiple concurrent viewers (up to 3)

### ❌ What fwdcast CANNOT do (yet)

- **No upload** - Viewers cannot upload files to you
- **No real-time sync** - Browser doesn't auto-refresh when files change
- **No persistent URLs** - Each session gets a new random URL
- **No file editing** - Read-only access for viewers

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
    └── protocol.go         # Message protocol
```

## Self-Hosting the Relay Server

You can run your own relay server for privacy or to remove limits.

```bash
cd relay
go build -o fwdcast-relay
./fwdcast-relay
```

Then use your relay:
```bash
fwdcast --relay wss://your-server.com/ws
```

See [relay/deploy/README.md](relay/deploy/README.md) for production deployment.

## Security Considerations

- **Password protection** - Add `-p` flag to require authentication
- **Passwords hashed** - Passwords are hashed with bcrypt, never stored in plain text
- **Rate limiting** - 5 failed password attempts triggers a 30-second lockout
- **Temporary by design** - Sessions auto-expire, reducing exposure window
- **No persistence** - Nothing is stored on the relay server
- **Path traversal protection** - CLI validates all file paths
- **Default excludes** - Sensitive files like `.env` are excluded by default
- **Secure cookies** - HttpOnly, Secure, SameSite flags enabled
- **Minimal logging** - No session IDs, URLs, or passwords in server logs

**Warning**: Without a password, anyone with your session URL can access your shared files.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

MIT License - see [LICENSE](LICENSE) for details.
