#!/usr/bin/env node

/**
 * fwdcast CLI - Temporary file sharing tool
 * Streams local files as a public website without uploading them
 * 
 * Requirements: 1.1, 1.5, 1.6, 7.1, 7.2, 7.4
 */

import { Command } from 'commander';
import * as path from 'path';
import { scanDirectory, calculateScanResult } from './scanner';
import { validateScanResult, formatSize } from './validator';
import { TunnelClient, TunnelClientConfig } from './tunnel-client';

/**
 * Default relay server URL
 */
const DEFAULT_RELAY_URL = 'wss://fwdcast.publicvm.com/ws';

/**
 * Session duration in milliseconds (30 minutes)
 */
const SESSION_DURATION_MS = 30 * 60 * 1000;

/**
 * Maximum number of connection retry attempts
 * Requirement: 7.4
 */
const MAX_RETRY_ATTEMPTS = 10;

/**
 * Delay between retry attempts in milliseconds
 */
const RETRY_DELAY_MS = 500;

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const program = new Command();

  program
    .name('fwdcast')
    .description('Temporary file sharing - stream local files as a public website without uploading')
    .version('1.0.0')
    .argument('[path]', 'Directory to share (default: current directory)', '.')
    .option('-r, --relay <url>', 'Custom relay server URL', DEFAULT_RELAY_URL)
    .addHelpText('after', `
Examples:
  $ fwdcast                    Share current directory
  $ fwdcast .                  Share current directory  
  $ fwdcast ~/Downloads        Share Downloads folder
  $ fwdcast ./project          Share a specific folder

Limits:
  • Max total size: 500 MB
  • Max file size: 100 MB
  • Session duration: 30 minutes
  • Concurrent viewers: 3

More info: https://github.com/vamsiy78/fwdcast
`)
    .action(async (dirPath: string, options: { relay: string }) => {
      await runShare(dirPath, options.relay);
    });

  await program.parseAsync(process.argv);
}

/**
 * Run the file sharing process
 * 
 * Requirements: 1.1, 1.5, 1.6, 7.1, 7.2
 */
async function runShare(dirPath: string, relayUrl: string): Promise<void> {
  const absolutePath = path.resolve(dirPath);
  
  console.log(`\nScanning directory: ${absolutePath}\n`);

  // Step 1: Scan the directory (Requirement 1.1)
  let entries;
  try {
    entries = await scanDirectory(absolutePath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      console.error(`Error: Directory not found: ${absolutePath}`);
    } else if (err.code === 'EACCES') {
      console.error(`Error: Permission denied: ${absolutePath}`);
    } else {
      console.error(`Error scanning directory: ${err.message}`);
    }
    process.exit(1);
  }

  // Step 2: Calculate scan result (Requirement 1.2)
  const scanResult = calculateScanResult(entries);
  console.log(`  Files: ${scanResult.fileCount}`);
  console.log(`  Directories: ${scanResult.directoryCount}`);
  console.log(`  Total size: ${formatSize(scanResult.totalSize)}\n`);

  // Step 3: Validate size limits (Requirements 1.3, 1.4)
  const validation = validateScanResult(scanResult);
  if (!validation.valid) {
    console.error('Error: Cannot share directory\n');
    for (const error of validation.errors) {
      if (error.type === 'total_size_exceeded') {
        console.error(`  - Total size (${formatSize(error.actualSize)}) exceeds the ${formatSize(error.limit)} limit`);
      } else if (error.type === 'file_size_exceeded') {
        console.error(`  - File "${error.file?.relativePath}" (${formatSize(error.actualSize)}) exceeds the ${formatSize(error.limit)} per-file limit`);
      } else {
        console.error(`  - ${error.message}`);
      }
    }
    console.error('\nTip: Remove large files or split your share into smaller directories.\n');
    process.exit(1);
  }

  // Step 4: Connect to relay server with retry logic (Requirements 1.5, 7.4)
  console.log(`Connecting to relay server...`);
  
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  
  const config: TunnelClientConfig = {
    relayUrl,
    basePath: absolutePath,
    entries,
    expiresAt,
    onUrl: (url) => {
      console.log(`\nShare active. URL:\n`);
      console.log(`  ${url}\n`);
      console.log(`Session expires in 30 minutes.`);
      console.log(`Press Ctrl+C to stop sharing.\n`);
    },
    onExpired: () => {
      // Requirement 7.2
      console.log('\nSession expired after 30 minutes.');
      console.log('Files are no longer accessible.\n');
      process.exit(0);
    },
    onDisconnect: () => {
      // Requirement 7.1
      console.log('\nDisconnected from relay server.');
      console.log('Files are no longer accessible.\n');
      process.exit(0);
    },
    onError: (error) => {
      // Requirement 7.4
      console.error(`\nConnection error: ${error.message}\n`);
    },
  };

  let client: TunnelClient | null = null;
  let lastError: Error | null = null;

  // Retry connection up to MAX_RETRY_ATTEMPTS times (Requirement 7.4)
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      client = new TunnelClient(config);
      await client.connect();
      lastError = null;
      break; // Connection successful
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < MAX_RETRY_ATTEMPTS) {
        console.log(`  Attempt ${attempt}/${MAX_RETRY_ATTEMPTS} failed: ${lastError.message}`);
        console.log(`  Retrying...\n`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  if (lastError) {
    // Requirement 7.4 - All retries failed
    console.error(`\nFailed to connect after ${MAX_RETRY_ATTEMPTS} attempts.`);
    console.error(`Last error: ${lastError.message}`);
    console.error(`\nPlease check:`);
    console.error(`  - Your internet connection`);
    console.error(`  - The relay server (${relayUrl}) is accessible`);
    console.error(`  - No firewall is blocking WebSocket connections\n`);
    process.exit(1);
  }

  // Handle graceful shutdown on Ctrl+C
  const shutdown = () => {
    console.log('\n\nStopping file share...');
    if (client) {
      client.disconnect();
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process running
  await new Promise(() => {});
}

// Run the CLI
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
