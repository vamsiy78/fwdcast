import { DirectoryEntry } from './scanner';
import { formatSize } from './validator';

/**
 * Gets the file icon based on file extension
 */
function getFileIcon(name: string, isDirectory: boolean): string {
  if (isDirectory) return '📁';
  
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const iconMap: Record<string, string> = {
    'js': '🟨', 'ts': '🔷', 'jsx': '⚛️', 'tsx': '⚛️',
    'py': '🐍', 'go': '🔵', 'rs': '🦀', 'java': '☕',
    'html': '🌐', 'css': '🎨', 'scss': '🎨',
    'json': '📋', 'xml': '📋', 'yaml': '📋', 'yml': '📋',
    'md': '📝', 'txt': '📄', 'pdf': '📕',
    'png': '🖼️', 'jpg': '🖼️', 'jpeg': '🖼️', 'gif': '🖼️', 'svg': '🖼️',
    'zip': '📦', 'tar': '📦', 'gz': '📦',
    'sh': '💻', 'bash': '💻',
  };
  
  return iconMap[ext] || '📄';
}

/**
 * Check if file is previewable as text
 */
function isTextFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const textExts = ['txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 
    'java', 'html', 'css', 'scss', 'xml', 'yaml', 'yml', 'sh', 'bash', 'c', 'cpp', 
    'h', 'hpp', 'rb', 'php', 'swift', 'kt', 'toml', 'ini', 'cfg', 'conf', 'log',
    'gitignore', 'env', 'dockerfile'];
  return textExts.includes(ext) || name.startsWith('.');
}

/**
 * Check if file is an image
 */
function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext);
}

/**
 * Generates an HTML directory listing page with VS Code-style UI.
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
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>fwdcast - ${escapeHtml(displayPath)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    :root {
      --bg-primary: #1e1e1e;
      --bg-secondary: #252526;
      --bg-tertiary: #2d2d2d;
      --bg-hover: #37373d;
      --bg-active: #094771;
      --text-primary: #cccccc;
      --text-secondary: #858585;
      --text-accent: #4fc1ff;
      --border-color: #3c3c3c;
    }
    
    body {
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      height: 100vh;
      overflow: hidden;
      font-size: 13px;
    }
    
    .app {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    
    /* Title Bar */
    .titlebar {
      height: 30px;
      background: var(--bg-tertiary);
      display: flex;
      align-items: center;
      padding: 0 12px;
      font-size: 12px;
      color: var(--text-secondary);
      border-bottom: 1px solid var(--border-color);
    }
    
    .titlebar-title {
      flex: 1;
      text-align: center;
    }
    
    /* Main Layout */
    .main {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    
    /* Activity Bar */
    .activitybar {
      width: 48px;
      background: var(--bg-secondary);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: 8px;
      border-right: 1px solid var(--border-color);
    }
    
    .activity-icon {
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      cursor: pointer;
      opacity: 0.6;
      border-left: 2px solid transparent;
    }
    
    .activity-icon.active {
      opacity: 1;
      border-left-color: var(--text-accent);
    }
    
    /* Sidebar */
    .sidebar {
      width: 240px;
      background: var(--bg-secondary);
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--border-color);
    }
    
    .sidebar-header {
      padding: 10px 20px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-secondary);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .download-all-btn {
      font-size: 16px;
      text-decoration: none;
      opacity: 0.7;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    
    .download-all-btn:hover {
      opacity: 1;
    }
    
    .file-tree {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
    }
    
    .tree-item {
      display: flex;
      align-items: center;
      padding: 4px 8px 4px 20px;
      cursor: pointer;
      text-decoration: none;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
    }
    
    .tree-item:hover {
      background: var(--bg-hover);
    }
    
    .tree-item.active {
      background: var(--bg-active);
    }
    
    .tree-icon {
      width: 16px;
      margin-right: 6px;
      flex-shrink: 0;
      font-size: 14px;
    }
    
    .tree-name {
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
    
    .tree-size {
      font-size: 11px;
      color: var(--text-secondary);
      margin-left: 8px;
    }
    
    /* Editor Area */
    .editor-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--bg-primary);
      overflow: hidden;
    }
    
    /* Tabs */
    .tabs {
      display: flex;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-color);
      min-height: 35px;
    }
    
    .tab {
      padding: 8px 16px;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border-color);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }
    
    .tab.active {
      background: var(--bg-primary);
    }
    
    .tab-icon {
      font-size: 14px;
    }
    
    /* Breadcrumb */
    .breadcrumb-bar {
      padding: 4px 12px;
      background: var(--bg-primary);
      border-bottom: 1px solid var(--border-color);
      font-size: 12px;
      color: var(--text-secondary);
    }
    
    .breadcrumb-bar a {
      color: var(--text-secondary);
      text-decoration: none;
    }
    
    .breadcrumb-bar a:hover {
      color: var(--text-accent);
    }
    
    /* Content */
    .content {
      flex: 1;
      overflow: auto;
      padding: 0;
    }
    
    .welcome {
      padding: 40px;
      text-align: center;
      color: var(--text-secondary);
    }
    
    .welcome h2 {
      font-size: 24px;
      font-weight: 300;
      margin-bottom: 16px;
      color: var(--text-primary);
    }
    
    .welcome p {
      font-size: 14px;
      margin-bottom: 8px;
    }
    
    /* File Preview */
    .preview {
      height: 100%;
      overflow: auto;
    }
    
    .preview-text {
      padding: 16px;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-wrap: break-word;
      background: var(--bg-primary);
    }
    
    .preview-image {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 20px;
    }
    
    .preview-image img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    
    .preview-download {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 16px;
    }
    
    .preview-download .icon {
      font-size: 64px;
    }
    
    .download-btn {
      padding: 10px 24px;
      background: var(--text-accent);
      color: var(--bg-primary);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      text-decoration: none;
    }
    
    .download-btn:hover {
      opacity: 0.9;
    }
    
    /* Loading */
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-secondary);
    }
    
    /* Status Bar */
    .statusbar {
      height: 22px;
      background: #007acc;
      display: flex;
      align-items: center;
      padding: 0 12px;
      font-size: 12px;
      color: white;
    }
    
    .statusbar-item {
      margin-right: 16px;
    }
    
    /* Scrollbar */
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: var(--bg-primary); }
    ::-webkit-scrollbar-thumb { background: #424242; border-radius: 5px; }
    ::-webkit-scrollbar-thumb:hover { background: #555; }
    
    /* Mobile Menu Toggle */
    .mobile-menu-toggle {
      display: none;
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 56px;
      height: 56px;
      background: var(--text-accent);
      border-radius: 50%;
      border: none;
      font-size: 24px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    
    .mobile-menu-toggle:active {
      transform: scale(0.95);
    }
    
    /* Mobile Responsive */
    @media (max-width: 768px) {
      body {
        font-size: 14px;
      }
      
      .titlebar {
        font-size: 13px;
        padding: 0 8px;
      }
      
      .activitybar {
        display: none;
      }
      
      .sidebar {
        position: fixed;
        left: 0;
        top: 30px;
        bottom: 22px;
        width: 85%;
        max-width: 320px;
        z-index: 999;
        transform: translateX(-100%);
        transition: transform 0.3s ease;
        box-shadow: 2px 0 8px rgba(0,0,0,0.3);
      }
      
      .sidebar.open {
        transform: translateX(0);
      }
      
      .mobile-overlay {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        z-index: 998;
      }
      
      .mobile-overlay.open {
        display: block;
      }
      
      .mobile-menu-toggle {
        display: flex;
      }
      
      .editor-area {
        width: 100%;
      }
      
      .tabs {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }
      
      .tab {
        padding: 10px 12px;
        font-size: 13px;
        white-space: nowrap;
      }
      
      .breadcrumb-bar {
        font-size: 11px;
        padding: 6px 8px;
        overflow-x: auto;
        white-space: nowrap;
        -webkit-overflow-scrolling: touch;
      }
      
      .welcome {
        padding: 20px;
      }
      
      .welcome h2 {
        font-size: 20px;
      }
      
      .preview-text {
        padding: 12px;
        font-size: 12px;
      }
      
      .preview-image {
        padding: 12px;
      }
      
      .tree-item {
        padding: 8px 12px;
        font-size: 14px;
      }
      
      .tree-icon {
        width: 20px;
        font-size: 16px;
      }
      
      .statusbar {
        font-size: 11px;
        padding: 0 8px;
      }
      
      .statusbar-item {
        margin-right: 12px;
      }
      
      .download-btn {
        padding: 12px 24px;
        font-size: 15px;
        touch-action: manipulation;
      }
      
      .sidebar-header {
        padding: 12px 16px;
      }
      
      .download-all-btn {
        font-size: 18px;
      }
    }
    
    @media (max-width: 480px) {
      .titlebar-title {
        font-size: 11px;
      }
      
      .sidebar {
        width: 90%;
      }
      
      .tree-size {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <div class="titlebar">
      <span class="titlebar-title">fwdcast - ${escapeHtml(displayPath)}</span>
    </div>
    
    <div class="mobile-overlay" id="mobileOverlay"></div>
    
    <div class="main">
      <div class="activitybar">
        <div class="activity-icon active" title="Explorer">📁</div>
      </div>
      
      <div class="sidebar" id="sidebar">
        <div class="sidebar-header">
          Explorer
          <a href="${baseUrl}${currentPath ? '/' + currentPath : ''}/__download__.zip" class="download-all-btn" title="Download all as ZIP">📥</a>
        </div>
        <div class="file-tree" id="fileTree">
${fileListItems}
        </div>
      </div>
      
      <div class="editor-area">
        <div class="tabs" id="tabs">
          <div class="tab active">
            <span class="tab-icon">📁</span>
            <span>Welcome</span>
          </div>
        </div>
        
        <div class="breadcrumb-bar">${breadcrumb}</div>
        
        <div class="content" id="content">
          <div class="welcome">
            <h2>📡 fwdcast</h2>
            <p>Select a file from the explorer to preview</p>
            <p style="font-size: 12px; margin-top: 20px;">
              ${sortedEntries.length} item${sortedEntries.length !== 1 ? 's' : ''} in this directory
            </p>
          </div>
        </div>
      </div>
    </div>
    
    <div class="statusbar">
      <span class="statusbar-item">📡 Connected</span>
      <span class="statusbar-item">${sortedEntries.filter(e => !e.isDirectory).length} files</span>
    </div>
    
    <button class="mobile-menu-toggle" id="mobileMenuToggle" aria-label="Toggle file explorer">
      📁
    </button>
  </div>
  
  <script>
    const baseUrl = '${baseUrl}';
    const currentPath = '${escapeHtml(currentPath)}';
    let activeFile = null;
    
    // Mobile menu toggle
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const sidebar = document.getElementById('sidebar');
    const mobileOverlay = document.getElementById('mobileOverlay');
    
    function toggleMobileMenu() {
      sidebar.classList.toggle('open');
      mobileOverlay.classList.toggle('open');
    }
    
    function closeMobileMenu() {
      sidebar.classList.remove('open');
      mobileOverlay.classList.remove('open');
    }
    
    if (mobileMenuToggle) {
      mobileMenuToggle.addEventListener('click', toggleMobileMenu);
    }
    
    if (mobileOverlay) {
      mobileOverlay.addEventListener('click', closeMobileMenu);
    }
    
    // File data for preview decisions
    const files = ${JSON.stringify(sortedEntries.map(e => ({
      name: e.name,
      isDirectory: e.isDirectory,
      size: e.size,
      href: generateHref(e, currentPath, sessionId)
    })))};
    
    function isTextFile(name) {
      const ext = name.split('.').pop()?.toLowerCase() || '';
      const textExts = ['txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 
        'java', 'html', 'css', 'scss', 'xml', 'yaml', 'yml', 'sh', 'bash', 'c', 'cpp', 
        'h', 'hpp', 'rb', 'php', 'swift', 'kt', 'toml', 'ini', 'cfg', 'conf', 'log',
        'gitignore', 'env', 'dockerfile'];
      return textExts.includes(ext) || name.startsWith('.');
    }
    
    function isImageFile(name) {
      const ext = name.split('.').pop()?.toLowerCase() || '';
      return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext);
    }
    
    function getFileIcon(name, isDir) {
      if (isDir) return '📁';
      const ext = name.split('.').pop()?.toLowerCase() || '';
      const icons = {
        'js': '🟨', 'ts': '🔷', 'py': '🐍', 'go': '🔵',
        'html': '🌐', 'css': '🎨', 'json': '📋', 'md': '📝',
        'txt': '📄', 'png': '🖼️', 'jpg': '🖼️', 'jpeg': '🖼️', 'gif': '🖼️', 'svg': '🖼️'
      };
      return icons[ext] || '📄';
    }
    
    document.querySelectorAll('.tree-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        const href = item.getAttribute('href');
        const name = item.dataset.name;
        const isDir = item.dataset.isdir === 'true';
        
        if (isDir) {
          // Navigate to directory
          window.location.href = href;
          return;
        }
        
        e.preventDefault();
        closeMobileMenu();
        
        // Update active state
        document.querySelectorAll('.tree-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        // Update tab
        document.getElementById('tabs').innerHTML = \`
          <div class="tab active">
            <span class="tab-icon">\${getFileIcon(name, false)}</span>
            <span>\${name}</span>
          </div>
        \`;
        
        const content = document.getElementById('content');
        
        if (isImageFile(name)) {
          content.innerHTML = \`
            <div class="preview-image">
              <img src="\${href}" alt="\${name}">
            </div>
          \`;
        } else if (isTextFile(name)) {
          content.innerHTML = '<div class="loading">Loading...</div>';
          try {
            const res = await fetch(href);
            const text = await res.text();
            content.innerHTML = \`<div class="preview"><pre class="preview-text">\${escapeHtml(text)}</pre></div>\`;
          } catch (err) {
            content.innerHTML = '<div class="loading">Failed to load file</div>';
          }
        } else {
          content.innerHTML = \`
            <div class="preview-download">
              <span class="icon">\${getFileIcon(name, false)}</span>
              <span>\${name}</span>
              <a href="\${href}" download class="download-btn">Download File</a>
            </div>
          \`;
        }
      });
    });
    
    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
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
  
  let html = `<a href="${baseHref}">~</a>`;
  
  let pathSoFar = '';
  for (const part of parts) {
    pathSoFar += part + '/';
    const href = sessionId ? `/${sessionId}/${pathSoFar}` : `/${pathSoFar}`;
    html += ` / <a href="${escapeHtml(href)}">${escapeHtml(part)}</a>`;
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
  
  return `          <a href="${escapeHtml(href)}" class="tree-item" data-name="${escapeHtml(entry.name)}" data-isdir="${entry.isDirectory}">
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
