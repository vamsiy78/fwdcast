# fwdcast

**Temporary file sharing** - Stream local files as a public website without uploading anything.

## Features

- **Instant sharing** - Get a public URL in seconds
- **No upload** - Files stream directly from your machine
- **VS Code-style UI** - Beautiful dark theme file browser
- **File preview** - View text, code, and images in-browser
- **ZIP download** - Download entire directories with one click
- **Password protection** - Secure your share with a password
- **QR code** - Easy mobile sharing with terminal QR code (shown by default)
- **Live stats** - View count and bandwidth in real-time
- **Custom duration** - Sessions from 1-120 minutes
- **Exclude files** - Skip .git, node_modules, etc.

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

### Use a custom relay server
```bash
fwdcast --relay wss://your-relay.com/ws
```

### Combine options
```bash
fwdcast ~/Documents -p secret123 -d 60 -q
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

- Maximum total size: 100 MB
- Maximum file size: 50 MB per file
- Session duration: 1-120 minutes (default: 30)
- Maximum concurrent viewers: 3

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

## Self-Hosting

You can run your own relay server. See the [relay documentation](https://github.com/vamsiy/fwdcast/tree/main/relay) for setup instructions.

## License

MIT
