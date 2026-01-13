# fwdcast

Temporary file sharing - stream local files as a public website without uploading.

## Features

- **No upload required** - Files stream directly from your machine
- **Instant sharing** - Get a public URL in seconds
- **VS Code-style UI** - Beautiful dark theme file browser
- **File preview** - View text files, images, and code in-browser
- **Download as ZIP** - Download entire directories with one click
- **Auto-expires** - Sessions automatically expire after 30 minutes

## Installation

```bash
npm install -g fwdcast
```

Or use directly with npx:

```bash
npx fwdcast
```

## Usage

Share the current directory:

```bash
fwdcast
```

Share a specific directory:

```bash
fwdcast /path/to/folder
```

Use a custom relay server:

```bash
fwdcast --relay wss://your-relay.com/ws
```

## How It Works

1. fwdcast scans your local directory
2. Connects to a relay server via WebSocket
3. You get a public URL to share
4. Viewers request files through the relay
5. Files stream directly from your machine - nothing is uploaded

## Limits

- Maximum total size: 500 MB
- Maximum file size: 100 MB per file
- Session duration: 30 minutes
- Maximum concurrent viewers: 3

## Self-Hosting

You can run your own relay server. See the [relay documentation](https://github.com/vamsiy/fwdcast/tree/main/relay) for setup instructions.

## License

MIT
