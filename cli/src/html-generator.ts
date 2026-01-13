import { DirectoryEntry } from './scanner';
import { formatSize } from './validator';

/**
 * Gets the file icon SVG based on file extension
 */
function getFileIcon(name: string, isDirectory: boolean): string {
  if (isDirectory) {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1.5 2.5h4.667l1.333 2H14.5v9h-13v-11z" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>`;
  }
  
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const codeExts = ['js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'rb', 'php', 'swift'];
  const docExts = ['md', 'txt', 'pdf', 'doc', 'docx'];
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'];
  const configExts = ['json', 'yaml', 'yml', 'xml', 'toml', 'ini', 'env'];
  
  if (codeExts.includes(ext)) {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (imageExts.includes(ext)) {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2.5" width="13" height="11" rx="1" stroke="currentColor" stroke-width="1.2"/><circle cx="5" cy="6" r="1.5" stroke="currentColor" stroke-width="1"/><path d="M1.5 11l3-3 2 2 4-4 4 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (configExts.includes(ext)) {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l6 3.5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.2"/></svg>`;
  }
  if (docExts.includes(ext)) {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3.5 1.5h6l3 3v10h-9v-13z" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 1.5v3h3" stroke="currentColor" stroke-width="1.2"/><path d="M5.5 7.5h5M5.5 10h5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>`;
  }
  
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3.5 1.5h6l3 3v10h-9v-13z" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 1.5v3h3" stroke="currentColor" stroke-width="1.2"/></svg>`;
}

function isTextFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const textExts = ['txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 
    'java', 'html', 'css', 'scss', 'xml', 'yaml', 'yml', 'sh', 'bash', 'c', 'cpp', 
    'h', 'hpp', 'rb', 'php', 'swift', 'kt', 'toml', 'ini', 'cfg', 'conf', 'log',
    'gitignore', 'env', 'dockerfile'];
  return textExts.includes(ext) || name.startsWith('.');
}

function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext);
}

/**
 * Generates an HTML directory listing page with modern minimal UI.
 */
export function generateDirectoryHtml(
  entries: DirectoryEntry[],
  currentPath: string,
  sessionId?: string
): string {
  const sortedEntries = sortEntries(entries);
  const fileListItems = sortedEntries.map(entry => generateFileListItem(entry, currentPath, sessionId)).join('\n');
  const breadcrumb = generateBreadcrumb(currentPath, sessionId);
  const displayPath = currentPath || '/';
  const baseUrl = sessionId ? `/${sessionId}` : '';
  const fileCount = sortedEntries.filter(e => !e.isDirectory).length;
  const folderCount = sortedEntries.filter(e => e.isDirectory).length;
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>fwdcast</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    :root {
      --bg-base: #0f1115;
      --bg-panel: #151922;
      --bg-elevated: #1c2029;
      --bg-hover: #252a35;
      --bg-active: #2d3340;
      --text-primary: #e4e4e7;
      --text-secondary: #71717a;
      --text-muted: #52525b;
      --accent: #6ee7b7;
      --accent-muted: rgba(110, 231, 183, 0.15);
      --border: rgba(255,255,255,0.06);
      --radius: 8px;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      background: var(--bg-base);
      color: var(--text-primary);
      height: 100vh;
      overflow: hidden;
      font-size: 13px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    
    .app {
      display: flex;
      height: 100vh;
    }
    
    /* Sidebar */
    .sidebar {
      width: 280px;
      background: var(--bg-panel);
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--border);
    }
    
    .sidebar-header {
      padding: 20px;
      border-bottom: 1px solid var(--border);
    }
    
    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
    }
    
    .logo-icon {
      width: 24px;
      height: 24px;
      background: var(--accent);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .logo-icon svg {
      width: 14px;
      height: 14px;
      color: var(--bg-base);
    }
    
    .logo-text {
      font-weight: 600;
      font-size: 15px;
      color: var(--text-primary);
    }
    
    .tagline {
      font-size: 11px;
      color: var(--text-muted);
      margin-left: 34px;
    }
    
    .file-tree {
      flex: 1;
      overflow-y: auto;
      padding: 12px 8px;
    }
    
    .tree-section {
      margin-bottom: 4px;
    }
    
    .tree-section-title {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      padding: 8px 12px 6px;
    }
    
    .tree-item {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      cursor: pointer;
      text-decoration: none;
      color: var(--text-secondary);
      border-radius: var(--radius);
      transition: all 0.15s ease;
      gap: 10px;
    }
    
    .tree-item:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    
    .tree-item.active {
      background: var(--accent-muted);
      color: var(--accent);
    }
    
    .tree-icon {
      flex-shrink: 0;
      opacity: 0.7;
    }
    
    .tree-item:hover .tree-icon,
    .tree-item.active .tree-icon {
      opacity: 1;
    }
    
    .tree-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
    }
    
    .tree-size {
      font-size: 11px;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
    
    .sidebar-footer {
      padding: 16px 20px;
      border-top: 1px solid var(--border);
    }
    
    .download-all {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px 16px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.15s ease;
    }
    
    .download-all:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
      border-color: rgba(255,255,255,0.1);
    }
</style>
</head>
<body>
  <div class="app">
    <div class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <div class="logo">
          <div class="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
          </div>
          <span class="logo-text">fwdcast</span>
        </div>
        <div class="tagline">Temporary file share · streamed live</div>
      </div>
      <div class="file-tree" id="fileTree">
        <div class="tree-section">
          <div class="tree-section-title">Files</div>
${fileListItems}
        </div>
      </div>
      <div class="sidebar-footer">
        <a href="${baseUrl}${currentPath ? '/' + currentPath : ''}/__download__.zip" class="download-all">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          Download all as ZIP
        </a>
      </div>
    </div>

    <div class="main-panel">
      <div class="context-bar">
        <div class="context-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          <span>Session active</span>
        </div>
        <div class="context-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          <span>Live from sender</span>
        </div>
        <div class="context-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <span id="viewerCount">Connected</span>
        </div>
      </div>
      
      <div class="breadcrumb-bar">${breadcrumb}</div>
      
      <div class="content" id="content">
        <div class="empty-state">
          <div class="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
          </div>
          <h2>Select a file to preview</h2>
          <p>Files stream directly from the sender's device</p>
          <div class="empty-stats">
            <span>${folderCount} folder${folderCount !== 1 ? 's' : ''}</span>
            <span class="dot">·</span>
            <span>${fileCount} file${fileCount !== 1 ? 's' : ''}</span>
          </div>
          <div class="ephemeral-notice">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            This link disappears when the sender closes it
          </div>
        </div>
      </div>
      
      <div class="footer">
        <span>Files are not stored on this server</span>
      </div>
    </div>
    
    <div class="mobile-overlay" id="mobileOverlay"></div>
    <button class="mobile-toggle" id="mobileToggle">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
    </button>
  </div>
  
  <style>
    /* Main Panel */
    .main-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--bg-base);
      overflow: hidden;
    }
    
    .context-bar {
      display: flex;
      align-items: center;
      gap: 24px;
      padding: 12px 24px;
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border);
    }
    
    .context-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--text-muted);
    }
    
    .context-item svg {
      opacity: 0.6;
    }
    
    .breadcrumb-bar {
      padding: 12px 24px;
      font-size: 12px;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
    }
    
    .breadcrumb-bar a {
      color: var(--text-secondary);
      text-decoration: none;
      transition: color 0.15s;
    }
    
    .breadcrumb-bar a:hover {
      color: var(--accent);
    }
    
    .breadcrumb-sep {
      margin: 0 8px;
      opacity: 0.4;
    }
    
    .content {
      flex: 1;
      overflow: auto;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .empty-state {
      text-align: center;
      padding: 40px;
      max-width: 400px;
    }
    
    .empty-icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 24px;
      background: var(--bg-panel);
      border-radius: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent);
    }
    
    .empty-state h2 {
      font-size: 18px;
      font-weight: 500;
      color: var(--text-primary);
      margin-bottom: 8px;
    }
    
    .empty-state p {
      font-size: 14px;
      color: var(--text-secondary);
      margin-bottom: 16px;
    }
    
    .empty-stats {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 32px;
    }
    
    .dot {
      opacity: 0.4;
    }
    
    .ephemeral-notice {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      background: var(--bg-panel);
      border-radius: var(--radius);
      font-size: 12px;
      color: var(--text-muted);
    }
    
    .footer {
      padding: 12px 24px;
      border-top: 1px solid var(--border);
      font-size: 11px;
      color: var(--text-muted);
      text-align: center;
    }
    
    /* Preview States */
    .preview {
      width: 100%;
      height: 100%;
      overflow: auto;
    }
    
    .preview-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 24px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-panel);
    }
    
    .preview-title {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .preview-title h3 {
      font-size: 14px;
      font-weight: 500;
    }
    
    .preview-title span {
      font-size: 12px;
      color: var(--text-muted);
    }
    
    .preview-actions {
      display: flex;
      gap: 8px;
    }
    
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      text-decoration: none;
      transition: all 0.15s;
      cursor: pointer;
      border: none;
    }
    
    .btn-primary {
      background: var(--accent);
      color: var(--bg-base);
    }
    
    .btn-primary:hover {
      opacity: 0.9;
    }
    
    .btn-secondary {
      background: var(--bg-elevated);
      color: var(--text-secondary);
      border: 1px solid var(--border);
    }
    
    .btn-secondary:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    
    .preview-text {
      padding: 24px;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 13px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-wrap: break-word;
      color: var(--text-secondary);
    }
    
    .preview-image {
      display: flex;
      align-items: center;
      justify-content: center;
      height: calc(100% - 60px);
      padding: 24px;
      background: var(--bg-panel);
    }
    
    .preview-image img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: var(--radius);
    }
    
    .preview-download {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 20px;
      padding: 40px;
    }
    
    .preview-download .file-icon {
      width: 80px;
      height: 80px;
      background: var(--bg-panel);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
    }
    
    .preview-download .file-icon svg {
      width: 32px;
      height: 32px;
    }
    
    .preview-download .file-name {
      font-size: 16px;
      font-weight: 500;
      color: var(--text-primary);
    }
    
    .preview-download .file-size {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: -12px;
    }
    
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
    }
    
    /* Scrollbar */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--bg-hover); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--bg-active); }
    
    /* Mobile */
    .mobile-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 998;
      backdrop-filter: blur(4px);
    }
    
    .mobile-overlay.open { display: block; }
    
    .mobile-toggle {
      display: none;
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 56px;
      height: 56px;
      background: var(--accent);
      color: var(--bg-base);
      border: none;
      border-radius: 16px;
      cursor: pointer;
      z-index: 1000;
      box-shadow: 0 4px 20px rgba(110, 231, 183, 0.3);
    }
    
    @media (max-width: 768px) {
      .sidebar {
        position: fixed;
        left: 0;
        top: 0;
        bottom: 0;
        z-index: 999;
        transform: translateX(-100%);
        transition: transform 0.3s ease;
      }
      
      .sidebar.open { transform: translateX(0); }
      
      .mobile-toggle { display: flex; align-items: center; justify-content: center; }
      
      .context-bar { 
        flex-wrap: wrap; 
        gap: 12px; 
        padding: 12px 16px; 
      }
      
      .breadcrumb-bar { padding: 12px 16px; }
      
      .empty-state { padding: 24px; }
      
      .preview-header { padding: 12px 16px; }
      
      .preview-text { padding: 16px; font-size: 12px; }
    }
  </style>

  <script>
    const baseUrl = '${baseUrl}';
    const currentPath = '${escapeHtml(currentPath)}';
    const sessionId = '${sessionId || ''}';
    
    // Live session updates via WebSocket
    if (sessionId) {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = wsProtocol + '//' + window.location.host + '/viewer-ws/' + sessionId;
      let ws = null;
      let reconnectAttempts = 0;
      const maxReconnectAttempts = 5;
      
      function connectViewerWS() {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
          reconnectAttempts = 0;
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'init' || data.type === 'viewerCount') {
              const count = data.count !== undefined ? data.count : data.viewerCount;
              document.getElementById('viewerCount').textContent = count + ' viewer' + (count !== 1 ? 's' : '');
            }
            if (data.type === 'init' && data.expiresAt) {
              startCountdown(data.expiresAt * 1000);
            }
          } catch (e) {}
        };
        
        ws.onclose = () => {
          if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            setTimeout(connectViewerWS, 2000 * reconnectAttempts);
          }
        };
        
        ws.onerror = () => ws.close();
      }
      
      let countdownInterval = null;
      function startCountdown(expiresAtMs) {
        if (countdownInterval) clearInterval(countdownInterval);
        
        const contextItems = document.querySelectorAll('.context-item');
        const sessionItem = contextItems[0];
        
        function updateCountdown() {
          const now = Date.now();
          const remaining = expiresAtMs - now;
          
          if (remaining <= 0) {
            sessionItem.querySelector('span').textContent = 'Session expired';
            clearInterval(countdownInterval);
            return;
          }
          
          const mins = Math.floor(remaining / 60000);
          const secs = Math.floor((remaining % 60000) / 1000);
          sessionItem.querySelector('span').textContent = mins + ':' + secs.toString().padStart(2, '0') + ' remaining';
        }
        
        updateCountdown();
        countdownInterval = setInterval(updateCountdown, 1000);
      }
      
      connectViewerWS();
    }
    
    // Mobile menu
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobileOverlay');
    const toggle = document.getElementById('mobileToggle');
    
    function openMenu() { sidebar.classList.add('open'); overlay.classList.add('open'); }
    function closeMenu() { sidebar.classList.remove('open'); overlay.classList.remove('open'); }
    
    toggle?.addEventListener('click', openMenu);
    overlay?.addEventListener('click', closeMenu);
    
    // File handling
    function isTextFile(name) {
      const ext = name.split('.').pop()?.toLowerCase() || '';
      const textExts = ['txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 
        'java', 'html', 'css', 'scss', 'xml', 'yaml', 'yml', 'sh', 'bash', 'c', 'cpp', 
        'h', 'hpp', 'rb', 'php', 'swift', 'kt', 'toml', 'ini', 'cfg', 'conf', 'log'];
      return textExts.includes(ext) || name.startsWith('.');
    }
    
    function isImageFile(name) {
      const ext = name.split('.').pop()?.toLowerCase() || '';
      return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext);
    }
    
    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    
    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
    
    document.querySelectorAll('.tree-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        const href = item.getAttribute('href');
        const name = item.dataset.name;
        const size = parseInt(item.dataset.size || '0');
        const isDir = item.dataset.isdir === 'true';
        
        if (isDir) {
          window.location.href = href;
          return;
        }
        
        e.preventDefault();
        closeMenu();
        
        document.querySelectorAll('.tree-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        const content = document.getElementById('content');
        
        if (isImageFile(name)) {
          content.innerHTML = \`
            <div class="preview">
              <div class="preview-header">
                <div class="preview-title">
                  <h3>\${escapeHtml(name)}</h3>
                  <span>\${formatBytes(size)}</span>
                </div>
                <div class="preview-actions">
                  <a href="\${href}" download class="btn btn-primary">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                    Download
                  </a>
                </div>
              </div>
              <div class="preview-image">
                <img src="\${href}" alt="\${escapeHtml(name)}">
              </div>
            </div>
          \`;
        } else if (isTextFile(name)) {
          content.innerHTML = '<div class="loading">Loading...</div>';
          try {
            const res = await fetch(href);
            const text = await res.text();
            content.innerHTML = \`
              <div class="preview">
                <div class="preview-header">
                  <div class="preview-title">
                    <h3>\${escapeHtml(name)}</h3>
                    <span>\${formatBytes(size)}</span>
                  </div>
                  <div class="preview-actions">
                    <a href="\${href}" download class="btn btn-primary">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                      Download
                    </a>
                  </div>
                </div>
                <pre class="preview-text">\${escapeHtml(text)}</pre>
              </div>
            \`;
          } catch (err) {
            content.innerHTML = '<div class="loading">Failed to load file</div>';
          }
        } else {
          content.innerHTML = \`
            <div class="preview-download">
              <div class="file-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3"/></svg>
              </div>
              <div class="file-name">\${escapeHtml(name)}</div>
              <div class="file-size">\${formatBytes(size)}</div>
              <a href="\${href}" download class="btn btn-primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                Download File
              </a>
            </div>
          \`;
        }
      });
    });
  </script>
</body>
</html>`;
}


/**
 * Generates breadcrumb navigation
 */
function generateBreadcrumb(currentPath: string, sessionId?: string): string {
  const parts = currentPath.split('/').filter(p => p);
  const baseHref = sessionId ? `/${sessionId}/` : '/';
  
  let html = `<a href="${baseHref}">Home</a>`;
  
  let pathSoFar = '';
  for (const part of parts) {
    pathSoFar += part + '/';
    const href = sessionId ? `/${sessionId}/${pathSoFar}` : `/${pathSoFar}`;
    html += ` <span class="breadcrumb-sep">/</span> <a href="${escapeHtml(href)}">${escapeHtml(part)}</a>`;
  }
  
  return html;
}

/**
 * Generates a file list item for the sidebar
 */
function generateFileListItem(entry: DirectoryEntry, currentPath: string, sessionId?: string): string {
  const href = generateHref(entry, currentPath, sessionId);
  const icon = getFileIcon(entry.name, entry.isDirectory);
  const sizeDisplay = entry.isDirectory ? '' : formatSize(entry.size);
  
  return `          <a href="${escapeHtml(href)}" class="tree-item" data-name="${escapeHtml(entry.name)}" data-isdir="${entry.isDirectory}" data-size="${entry.size}">
            <span class="tree-icon">${icon}</span>
            <span class="tree-name">${escapeHtml(entry.name)}${entry.isDirectory ? '/' : ''}</span>
            ${sizeDisplay ? `<span class="tree-size">${sizeDisplay}</span>` : ''}
          </a>`;
}

/**
 * Sorts entries with directories first, then files, alphabetically within each group.
 */
export function sortEntries(entries: DirectoryEntry[]): DirectoryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

/**
 * Generates the href link for an entry.
 */
export function generateHref(entry: DirectoryEntry, currentPath: string, sessionId?: string): string {
  const normalizedCurrent = currentPath.replace(/^\/+|\/+$/g, '');
  
  let pathPart: string;
  if (normalizedCurrent) {
    pathPart = `${normalizedCurrent}/${entry.name}${entry.isDirectory ? '/' : ''}`;
  } else {
    pathPart = `${entry.name}${entry.isDirectory ? '/' : ''}`;
  }
  
  if (sessionId) {
    return `/${sessionId}/${pathPart}`;
  }
  return `/${pathPart}`;
}

/**
 * Escapes HTML special characters to prevent XSS.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Filters entries to only include direct children of the given path.
 */
export function getDirectChildren(
  allEntries: DirectoryEntry[],
  parentPath: string
): DirectoryEntry[] {
  const normalizedParent = parentPath.replace(/^\/+|\/+$/g, '');
  
  return allEntries.filter(entry => {
    const entryDir = entry.relativePath.includes('/')
      ? entry.relativePath.substring(0, entry.relativePath.lastIndexOf('/'))
      : '';
    return entryDir === normalizedParent;
  });
}
