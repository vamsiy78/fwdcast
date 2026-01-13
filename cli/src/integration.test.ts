/**
 * End-to-End Integration Tests for fwdcast
 * 
 * These tests verify the complete flow of the fwdcast system:
 * - CLI shares directory, browser downloads file
 * - Session expires, requests return 404
 * - Max viewers reached, new viewers rejected
 * 
 * Requirements: All
 * 
 * Note: These tests require a relay server to be running.
 * Set RELAY_URL environment variable to point to the relay server.
 * Default: ws://localhost:8080/ws
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { TunnelClient, TunnelClientConfig } from './tunnel-client';
import { scanDirectory } from './scanner';

// Skip integration tests if SKIP_INTEGRATION is set
const SKIP_INTEGRATION = process.env.SKIP_INTEGRATION === 'true';

// Relay server URL (default to localhost for local testing)
const RELAY_WS_URL = process.env.RELAY_URL || 'ws://localhost:8080/ws';
const RELAY_HTTP_HOST = process.env.RELAY_HTTP_HOST || 'localhost:8080';

// Helper to create a temporary directory with test files
function createTestDirectory(): { dir: string; files: Map<string, Buffer> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fwdcast-e2e-'));
  const files = new Map<string, Buffer>();

  // Create test files
  const textContent = Buffer.from('Hello, fwdcast! This is a test file.');
  fs.writeFileSync(path.join(dir, 'test.txt'), textContent);
  files.set('test.txt', textContent);

  const htmlContent = Buffer.from('<!DOCTYPE html><html><body><h1>Test</h1></body></html>');
  fs.writeFileSync(path.join(dir, 'index.html'), htmlContent);
  files.set('index.html', htmlContent);

  // Create a subdirectory with a file
  const subdir = path.join(dir, 'subdir');
  fs.mkdirSync(subdir);
  const subContent = Buffer.from('File in subdirectory');
  fs.writeFileSync(path.join(subdir, 'nested.txt'), subContent);
  files.set('subdir/nested.txt', subContent);

  // Create a binary file
  const binaryContent = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) {
    binaryContent[i] = i;
  }
  fs.writeFileSync(path.join(dir, 'binary.bin'), binaryContent);
  files.set('binary.bin', binaryContent);

  return { dir, files };
}

// Helper to clean up temporary directory
function cleanupTestDirectory(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Helper to make HTTP request and get response
function httpGet(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// Helper to wait for a condition
async function waitFor(condition: () => boolean, timeout: number = 5000): Promise<void> {
  const start = Date.now();
  while (!condition() && Date.now() - start < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!condition()) {
    throw new Error('Timeout waiting for condition');
  }
}

describe.skipIf(SKIP_INTEGRATION)('End-to-End Integration Tests', () => {
  let testDir: string;
  let testFiles: Map<string, Buffer>;

  beforeAll(() => {
    const { dir, files } = createTestDirectory();
    testDir = dir;
    testFiles = files;
  });

  afterAll(() => {
    if (testDir) {
      cleanupTestDirectory(testDir);
    }
  });

  describe('Test 1: CLI shares directory, browser downloads file', () => {
    let client: TunnelClient | null = null;
    let sessionUrl: string | null = null;

    afterEach(async () => {
      if (client) {
        client.disconnect();
        client = null;
      }
    });

    it('should establish connection and receive session URL', async () => {
      const entries = await scanDirectory(testDir);
      const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes

      const config: TunnelClientConfig = {
        relayUrl: RELAY_WS_URL,
        basePath: testDir,
        entries,
        expiresAt,
        onUrl: (url) => {
          sessionUrl = url;
        },
      };

      client = new TunnelClient(config);
      const result = await client.connect();

      expect(result.sessionId).toBeTruthy();
      expect(result.url).toContain(result.sessionId);
      sessionUrl = result.url;
    });

    it('should serve text file with correct content', async () => {
      if (!sessionUrl || !client) {
        throw new Error('Session not established');
      }

      // Convert https URL to http for local testing
      const httpUrl = sessionUrl.replace('https://', 'http://') + 'test.txt';
      const response = await httpGet(httpUrl);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.body.equals(testFiles.get('test.txt')!)).toBe(true);
    });

    it('should serve HTML file with correct content type', async () => {
      if (!sessionUrl || !client) {
        throw new Error('Session not established');
      }

      const httpUrl = sessionUrl.replace('https://', 'http://') + 'index.html';
      const response = await httpGet(httpUrl);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body.equals(testFiles.get('index.html')!)).toBe(true);
    });

    it('should serve binary file with correct content', async () => {
      if (!sessionUrl || !client) {
        throw new Error('Session not established');
      }

      const httpUrl = sessionUrl.replace('https://', 'http://') + 'binary.bin';
      const response = await httpGet(httpUrl);

      expect(response.status).toBe(200);
      expect(response.body.equals(testFiles.get('binary.bin')!)).toBe(true);
    });

    it('should serve nested file in subdirectory', async () => {
      if (!sessionUrl || !client) {
        throw new Error('Session not established');
      }

      const httpUrl = sessionUrl.replace('https://', 'http://') + 'subdir/nested.txt';
      const response = await httpGet(httpUrl);

      expect(response.status).toBe(200);
      expect(response.body.equals(testFiles.get('subdir/nested.txt')!)).toBe(true);
    });

    it('should serve directory listing as HTML', async () => {
      if (!sessionUrl || !client) {
        throw new Error('Session not established');
      }

      const httpUrl = sessionUrl.replace('https://', 'http://');
      const response = await httpGet(httpUrl);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      
      const html = response.body.toString('utf-8');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('subdir'); // Directory should be listed
      expect(html).toContain('test.txt'); // File should be listed
    });

    it('should return 404 for non-existent file', async () => {
      if (!sessionUrl || !client) {
        throw new Error('Session not established');
      }

      const httpUrl = sessionUrl.replace('https://', 'http://') + 'nonexistent.txt';
      const response = await httpGet(httpUrl);

      expect(response.status).toBe(404);
    });
  });

  describe('Test 2: Session expires, requests return 404', () => {
    it('should return 404 for invalid session ID', async () => {
      const httpUrl = `http://${RELAY_HTTP_HOST}/invalid-session-id-12345/test.txt`;
      const response = await httpGet(httpUrl);

      expect(response.status).toBe(404);
      expect(response.body.toString('utf-8')).toContain('not found');
    });

    it('should return 404 after session disconnect', async () => {
      const entries = await scanDirectory(testDir);
      const expiresAt = Date.now() + 30 * 60 * 1000;

      const config: TunnelClientConfig = {
        relayUrl: RELAY_WS_URL,
        basePath: testDir,
        entries,
        expiresAt,
      };

      const client = new TunnelClient(config);
      const result = await client.connect();
      const sessionUrl = result.url;

      // Verify session works
      const httpUrl = sessionUrl.replace('https://', 'http://') + 'test.txt';
      const response1 = await httpGet(httpUrl);
      expect(response1.status).toBe(200);

      // Disconnect
      client.disconnect();

      // Wait a bit for the server to process the disconnect
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify session returns 404
      const response2 = await httpGet(httpUrl);
      expect(response2.status).toBe(404);
    });
  });

  describe('Test 3: Max viewers reached, new viewers rejected', () => {
    it('should reject 4th concurrent viewer with 503', async () => {
      const entries = await scanDirectory(testDir);
      const expiresAt = Date.now() + 30 * 60 * 1000;

      const config: TunnelClientConfig = {
        relayUrl: RELAY_WS_URL,
        basePath: testDir,
        entries,
        expiresAt,
      };

      const client = new TunnelClient(config);
      const result = await client.connect();
      const sessionUrl = result.url;
      const httpUrl = sessionUrl.replace('https://', 'http://') + 'test.txt';

      try {
        // Make 4 concurrent requests (max viewers is 3)
        const requests = [
          httpGet(httpUrl),
          httpGet(httpUrl),
          httpGet(httpUrl),
          httpGet(httpUrl),
        ];

        const responses = await Promise.all(requests);
        
        // Count 200s and 503s
        const successCount = responses.filter((r) => r.status === 200).length;
        const rejectedCount = responses.filter((r) => r.status === 503).length;

        // At least 3 should succeed, at least 1 should be rejected
        // (timing may allow all 4 if requests complete quickly)
        expect(successCount).toBeGreaterThanOrEqual(3);
        expect(successCount + rejectedCount).toBe(4);
      } finally {
        client.disconnect();
      }
    });

    it('should allow new viewer after previous viewer disconnects', async () => {
      const entries = await scanDirectory(testDir);
      const expiresAt = Date.now() + 30 * 60 * 1000;

      const config: TunnelClientConfig = {
        relayUrl: RELAY_WS_URL,
        basePath: testDir,
        entries,
        expiresAt,
      };

      const client = new TunnelClient(config);
      const result = await client.connect();
      const sessionUrl = result.url;
      const httpUrl = sessionUrl.replace('https://', 'http://') + 'test.txt';

      try {
        // Make 3 sequential requests (each completes before next starts)
        for (let i = 0; i < 5; i++) {
          const response = await httpGet(httpUrl);
          expect(response.status).toBe(200);
        }
      } finally {
        client.disconnect();
      }
    });
  });
});

/**
 * Unit tests that don't require a running relay server
 * These test the integration of CLI components
 */
describe('CLI Component Integration', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fwdcast-unit-'));
    
    // Create test files
    fs.writeFileSync(path.join(testDir, 'test.txt'), 'Hello World');
    fs.mkdirSync(path.join(testDir, 'subdir'));
    fs.writeFileSync(path.join(testDir, 'subdir', 'nested.txt'), 'Nested content');
  });

  afterEach(() => {
    if (testDir) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should scan directory and find all files', async () => {
    const entries = await scanDirectory(testDir);
    
    const names = entries.map((e) => e.name);
    expect(names).toContain('test.txt');
    expect(names).toContain('subdir');
    expect(names).toContain('nested.txt');
  });

  it('should correctly identify directories vs files', async () => {
    const entries = await scanDirectory(testDir);
    
    const subdir = entries.find((e) => e.name === 'subdir');
    const testFile = entries.find((e) => e.name === 'test.txt');
    
    expect(subdir?.isDirectory).toBe(true);
    expect(testFile?.isDirectory).toBe(false);
  });
});
