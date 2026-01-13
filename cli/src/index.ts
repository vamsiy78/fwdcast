#!/usr/bin/env node

/**
 * fwdcast CLI - Temporary file sharing tool
 * Streams local files as a public website without uploading them
 */

import { Command } from 'commander';
import * as path from 'path';
import * as qrcode from 'qrcode-terminal';
import { scanDirectory, calculateScanResult } from './scanner';
import { validateScanResult, formatSize } from './validator';
import { TunnelClient, TunnelClientConfig, TransferStats } from './tunnel-client';

/**
 * Default relay server URL
 */
const DEFAULT_RELAY_URL = 'wss://fwdcast.publicvm.com/ws';

/**
 * Default session duration in minutes
 */
const DEFAULT_DURATION_MINUTES = 30;

/**
 * Maximum session duration in minutes (2 hours)
 */
const MAX_DURATION_MINUTES = 120;

/**
 * Minimum session duration in minutes
 */
const MIN_DURATION_MINUTES = 1;

/**
 * Maximum number of connection retry attempts
 */
const MAX_RETRY_ATTEMPTS = 10;

/**
 * Delay between retry attempts in milliseconds
 */
const RETRY_DELAY_MS = 500;

/**
 * Default exclude patterns
 */
const DEFAULT_EXCLUDES = ['.git', 'node_modules', '.DS_Store', '__pycache__', '.env'];

/**
 * CLI options interface
 */
interface CliOptions {
  relay: string;
  password?: string;
  exclude?: string[];
  duration: string;
  qr: boolean;
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format transfer speed
 */
function formatSpeed(bytesPerSecond: number): string {
  return formatBytes(bytesPerSecond) + '/s';
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse duration string to minutes
 */
function parseDuration(value: string): number {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < MIN_DURATION_MINUTES) {
    return MIN_DURATION_MINUTES;
  }
  if (num > MAX_DURATION_MINUTES) {
    return MAX_DURATION_MINUTES;
  }
  return num;
}

/**
 * Format duration for display
 */
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  return `${hours}h ${mins}m`;
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const program = new Command();

  program
    .name('fwdcast')
    .description('Temporary file sharing - stream local files as a public website without uploading')
    .version('1.2.10')
    .argument('[path]', 'Directory to share (default: current directory)', '.')
    .option('-r, --relay <url>', 'Custom relay server URL', DEFAULT_RELAY_URL)
    .option('-p, --password <password>', 'Require password to access files')
    .option('-e, --exclude <patterns...>', 'Exclude files/folders matching patterns (e.g., -e .git node_modules)')
    .option('-d, --duration <minutes>', 'Session duration in minutes (1-120)', String(DEFAULT_DURATION_MINUTES))
    .option('-q, --qr', 'Show QR code for easy mobile sharing', true)
    .addHelpText('after', `
Examples:
  $ fwdcast                              Share current directory
  $ fwdcast ~/Downloads                  Share Downloads folder
  $ fwdcast -p secret123                 Password protect the share
  $ fwdcast -e .git node_modules         Exclude .git and node_modules
  $ fwdcast -d 60                        Session lasts 60 minutes
  $ fwdcast --no-qr                      Hide QR code (shown by default)
  $ fwdcast -p mypass -d 120 -e .git     Combine options

Default excludes (always applied):
  ${DEFAULT_EXCLUDES.join(', ')}

Limits:
  • Max total size: 500 MB
  • Max file size: 100 MB
  • Session duration: 1-120 minutes (default: 30)
  • Concurrent viewers: 3

More info: https://github.com/vamsiy78/fwdcast
`)
    .action(async (dirPath: string, options: CliOptions) => {
      await runShare(dirPath, options);
    });

  await program.parseAsync(process.argv);
}

/**
 * Run the file sharing process
 */
async function runShare(dirPath: string, options: CliOptions): Promise<void> {
  const absolutePath = path.resolve(dirPath);
  const durationMinutes = parseDuration(options.duration);
  const durationMs = durationMinutes * 60 * 1000;
  
  // Combine default excludes with user-provided excludes
  const excludePatterns = [...DEFAULT_EXCLUDES];
  if (options.exclude && options.exclude.length > 0) {
    excludePatterns.push(...options.exclude);
  }
  // Remove duplicates
  const uniqueExcludes = [...new Set(excludePatterns)];
  
  console.log(`\nScanning directory: ${absolutePath}`);
  if (uniqueExcludes.length > 0) {
    console.log(`Excluding: ${uniqueExcludes.join(', ')}`);
  }
  console.log('');

  // Step 1: Scan the directory with exclusions
  let entries;
  try {
    entries = await scanDirectory(absolutePath, undefined, uniqueExcludes);
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

  // Step 2: Calculate scan result
  const scanResult = calculateScanResult(entries);
  console.log(`  Files: ${scanResult.fileCount}`);
  console.log(`  Directories: ${scanResult.directoryCount}`);
  console.log(`  Total size: ${formatSize(scanResult.totalSize)}\n`);

  // Step 3: Validate size limits
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
    console.error('\nTip: Remove large files or use --exclude to skip them.\n');
    process.exit(1);
  }

  // Step 4: Connect to relay server
  console.log(`Connecting to relay server...`);
  
  const expiresAt = Date.now() + durationMs;
  
  const config: TunnelClientConfig = {
    relayUrl: options.relay,
    basePath: absolutePath,
    entries,
    expiresAt,
    password: options.password,
    excludePatterns: uniqueExcludes,
    onUrl: (url) => {
      console.log(`\nShare active. URL:\n`);
      console.log(`  ${url}\n`);
      if (options.password) {
        console.log(`Password: ${options.password}`);
      }
      console.log(`Session expires in ${formatDuration(durationMinutes)}.`);
      
      // Show QR code if requested
      if (options.qr) {
        console.log(`\nScan QR code to access on mobile:\n`);
        qrcode.generate(url, { small: true });
      }
      
      console.log(`\nPress Ctrl+C to stop sharing.\n`);
    },
    onStats: (stats: TransferStats) => {
      // Clear line and show stats
      const viewerText = stats.activeViewers === 1 ? '1 viewer' : `${stats.activeViewers} viewers`;
      const speedText = stats.currentSpeed > 0 ? ` | ${formatSpeed(stats.currentSpeed)}` : '';
      process.stdout.write(`\r[${viewerText}] Total: ${formatBytes(stats.totalBytesSent)} | Requests: ${stats.requestCount}${speedText}    `);
    },
    onExpired: () => {
      console.log(`\nSession expired after ${formatDuration(durationMinutes)}.`);
      console.log('Files are no longer accessible.\n');
      process.exit(0);
    },
    onDisconnect: () => {
      console.log('\nDisconnected from relay server.');
      console.log('Files are no longer accessible.\n');
      process.exit(0);
    },
    onError: (error) => {
      console.error(`\nConnection error: ${error.message}\n`);
    },
  };

  let client: TunnelClient | null = null;
  let lastError: Error | null = null;

  // Retry connection
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      client = new TunnelClient(config);
      await client.connect();
      lastError = null;
      break;
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
    console.error(`\nFailed to connect after ${MAX_RETRY_ATTEMPTS} attempts.`);
    console.error(`Last error: ${lastError.message}`);
    console.error(`\nPlease check:`);
    console.error(`  - Your internet connection`);
    console.error(`  - The relay server (${options.relay}) is accessible`);
    console.error(`  - No firewall is blocking WebSocket connections\n`);
    process.exit(1);
  }

  // Handle graceful shutdown
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
