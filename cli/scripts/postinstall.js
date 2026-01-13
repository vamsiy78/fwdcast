#!/usr/bin/env node

// Only show message for global installs
if (!process.env.npm_config_global) {
  process.exit(0);
}

console.log(`
┌─────────────────────────────────────────────────┐
│                                                 │
│   📡 fwdcast installed successfully!            │
│                                                 │
│   Quick start:                                  │
│     fwdcast              Share current folder   │
│     fwdcast ~/Downloads  Share specific folder  │
│                                                 │
│   Help:                                         │
│     fwdcast --help                              │
│                                                 │
│   GitHub: github.com/vamsiy78/fwdcast           │
│                                                 │
└─────────────────────────────────────────────────┘
`);
