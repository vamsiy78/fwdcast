# Contributing to fwdcast

Thanks for your interest in contributing to fwdcast! This document provides guidelines for contributing.

## Getting Started

### Prerequisites

- Node.js 18+
- Go 1.21+
- npm or yarn

### Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/fwdcast.git
   cd fwdcast
   ```

3. Install CLI dependencies:
   ```bash
   cd cli
   npm install
   ```

4. Build the CLI:
   ```bash
   npm run build
   ```

5. Build the relay server:
   ```bash
   cd ../relay
   go build -o fwdcast-relay
   ```

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

## Development

### Running the CLI locally

```bash
cd cli
npm run dev -- /path/to/share
```

### Running tests

```bash
cd cli
npm test
```

### Running the relay locally

```bash
cd relay
RELAY_HOST=localhost:8080 go run .
```

Then use the CLI with your local relay:
```bash
cd cli
npm run dev -- --relay ws://localhost:8080/ws /path/to/share
```

## Making Changes

1. Create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes

3. Run tests:
   ```bash
   cd cli && npm test
   ```

4. Commit your changes:
   ```bash
   git commit -m "feat: description of your change"
   ```

   We follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `refactor:` - Code refactoring
   - `test:` - Adding tests
   - `chore:` - Maintenance tasks

5. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

6. Open a Pull Request

## Pull Request Guidelines

- Keep PRs focused on a single change
- Update documentation if needed
- Add tests for new features
- Ensure all tests pass
- Follow existing code style

## Reporting Issues

When reporting issues, please include:

- fwdcast version (`fwdcast --version`)
- Node.js version (`node --version`)
- Operating system
- Steps to reproduce
- Expected vs actual behavior

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow

## Questions?

Feel free to open an issue for questions or discussions.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
