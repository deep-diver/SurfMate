// Browse - AI-Powered Navigation (Pro Version)

// Gradio detection and helpers
function isGradioApp() {
  // Check for Gradio container or other Gradio-specific markers
  return !!(
    document.querySelector('.gradio-container') ||
    document.querySelector('[class*="gradio"]') ||
    document.querySelector('#gradio-app')
  );
}

function getGradioVersion() {
  // Try to detect Gradio version from meta tags or script tags
  const gradioScript = document.querySelector('script[src*="gradio"]');
  if (gradioScript) {
    const match = gradioScript.src.match(/gradio.*?(\d+\.\d+\.\d+)/);
    return match ? match[1] : 'unknown';
  }
  return 'unknown';
}

// Gradio-specific container selectors
const GRADIO_CONTAINER_SELECTORS = [
  // Main layout components
  '.gradio-container',
  '[class*="gradio-row"]',
  '[class*="gradio-column"]',
  '[class*="gradio-group"]',
  '[class*="gradio-tabs"]',
  '[class*="gradio-accordion"]',
  '[class*="gradio-box"]',
  '[class*="gradio-block"]',
  // Form components (treat as containers if they have labels)
  '[class*="gradio-textbox"]',
  '[class*="gradio-dropdown"]',
  '[class*="gradio-radio"]',
  '[class*="gradio-checkbox"]',
  '[class*="gradio-slider"]',
  '[class*="gradio-image"]',
  '[class*="gradio-video"]',
  '[class*="gradio-audio"]',
  '[class*="gradio-file"]',
  '[class*="gradio-gallery"]',
  '[class*="gradio-dataframe"]',
  '[class*="gradio-chatbot"]',
  '[class*="gradio-markdown"]',
];

// Gradio component priorities (for better element detection)
const GRADIO_COMPONENT_PRIORITIES = {
  'gradio-button': 1100,
  'gradio-submit-button': 1150,
  'gradio-clear-button': 1050,
  'gradio-textbox': 900,
  'gradio-textarea': 890,
  'gradio-dropdown': 880,
  'gradio-radio': 870,
  'gradio-checkbox': 860,
  'gradio-slider': 850,
  'gradio-file': 840,
  'gradio-gallery': 700,
  'gradio-chatbot': 700,
  'gradio-dataframe': 650,
};

// State
const state = {
  active: false,
  containers: [],
  standalone: [],
  annotations: [], // All annotations for hover effects
  currentContainer: null, // When zoomed into a container
  currentElements: [], // Elements in current container
  keyToElement: new Map(),
  overlay: null,
  apiKey: '',
  enabled: false,
  mode: 'normal', // normal, follow, command
  navigationLevel: 'containers', // 'containers' or 'elements'
  macroRecording: false,
  currentMacro: [],
  sessions: new Map(),
  followModeInput: '',
  followModeSelectedIndex: 0, // For arrow key navigation
  followModeMatches: [], // Cached matches for arrow navigation
  // Breadcrumb trail for navigation history
  breadcrumbTrail: [],
  // Recently interacted elements (for highlights)
  recentElements: new Set(),
  // Tooltip element
  activeTooltip: null,
  // Gradio detection
  isGradio: false,
  gradioVersion: 'unknown'
};

// Resize debounce timeout
let resizeTimeout = null;

// Scroll throttle timeout
let scrollTimeout = null;
let scrollPending = false;

// Constants
const NUMBERS = '123456789';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
// Extended keys for more elements (case-insensitive in practice, but we check both)
const EXTENDED_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // Will require Shift key
// Combined all available single-key shortcuts (total 61)
const ALL_KEYS = NUMBERS + LETTERS + EXTENDED_KEYS;
const MODES = {
  NORMAL: 'normal',
  FOLLOW: 'follow',
  COMMAND: 'command'
};

// Color scheme (gorgeous neon doodle-style)
const COLORS = {
  primary: '#22CC66',      // Clear green
  secondary: '#DDDD00',    // Clear yellow
  accent: '#CC33BB',       // Clear magenta
  muted: '#DD6633',        // Clear orange for inactive
  bg: 'rgba(8, 8, 12, 0.88)',   // Deep rich black-blue
  border: 'rgba(255, 255, 255, 0.6)',
  text: '#ffffff'
};

// Sanitize selector to handle problematic pseudo-classes
function sanitizeSelector(selector, doc = document) {
  if (!selector) return null;

  // Try the original selector first
  try {
    const testEl = doc.querySelector(selector);
    if (testEl) return selector;
  } catch (e) {
    // Selector is invalid, try to fix it
    console.log('[Browse] Invalid selector, sanitizing:', selector);
  }

  // Strategy 1: Remove :nth-child() pseudo-classes
  let sanitized = selector
    .replace(/:nth-child\([^)]*\)/g, '')
    .replace(/:nth-of-type\([^)]*\)/g, '')
    .replace(/:first-child/g, '')
    .replace(/:last-child/g, '')
    .replace(/\s*>\s*>\s*/g, ' > ')
    .replace(/\s+/g, ' ')
    .trim();

  if (sanitized !== selector) {
    try {
      const testEl = doc.querySelector(sanitized);
      if (testEl) {
        console.log('[Browse] Sanitized (nth-child removal):', selector, '->', sanitized);
        return sanitized;
      }
    } catch (e) {}

    // Strategy 2: Try just the last part of the selector
    const parts = sanitized.split(' > ');
    if (parts.length > 2) {
      // Try last 2 parts
      const shortSelector = parts.slice(-2).join(' > ');
      try {
        const testEl = doc.querySelector(shortSelector);
        if (testEl) {
          console.log('[Browse] Sanitized (last 2 parts):', selector, '->', shortSelector);
          return shortSelector;
        }
      } catch (e) {}

      // Try just the last part
      const lastPart = parts[parts.length - 1];
      try {
        const testEl = doc.querySelector(lastPart);
        if (testEl) {
          console.log('[Browse] Sanitized (last part):', selector, '->', lastPart);
          return lastPart;
        }
      } catch (e) {}
    }
  }

  console.warn('[Browse] Could not sanitize selector:', selector);
  return null;
}

// Query element with selector sanitization
function queryElementSafe(selector) {
  const sanitized = sanitizeSelector(selector);
  if (!sanitized) return null;
  return document.querySelector(sanitized);
}

// Initialize
function init() {
  loadState();
  setupEventListeners();
  observeChanges();
  loadSessions();
}

// Load saved state
function loadState() {
  chrome.storage.local.get(['apiKey', 'browseEnabled', 'browseSessions'], (result) => {
    state.apiKey = result.apiKey || '';
    state.enabled = result.browseEnabled || false;

    if (result.browseSessions) {
      try {
        const sessions = JSON.parse(result.browseSessions);
        Object.entries(sessions).forEach(([name, data]) => {
          state.sessions.set(name, data);
        });
      } catch (e) {}
    }

    if (state.enabled && state.apiKey) {
      activate();
    }
  });
}

// Setup event listeners
function setupEventListeners() {
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);
  document.addEventListener('mousemove', handleMouseMove, { passive: true });
  chrome.runtime.onMessage.addListener(handleMessage);

  // Handle window resize to update hint positions
  window.addEventListener('resize', handleResize);

  // Handle scroll to update hint positions
  window.addEventListener('scroll', handleScroll, { passive: true });
}

// Handle window resize with debouncing
function handleResize() {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    if (!state.active) return;

    // Re-render based on current navigation level
    if (state.navigationLevel === 'containers') {
      renderContainers();
    } else if (state.navigationLevel === 'elements' && state.currentContainer) {
      renderContainerElements(state.currentContainer);
    }
  }, 200); // 200ms debounce
}

// Handle scroll with throttling
function handleScroll() {
  if (!state.active) return;

  // Use requestAnimationFrame for smooth updates
  if (!scrollPending) {
    scrollPending = true;

    requestAnimationFrame(() => {
      scrollPending = false;

      // Clear any pending timeout
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }

      // Throttle: update at most every 50ms
      scrollTimeout = setTimeout(() => {
        // Re-render based on current navigation level
        if (state.navigationLevel === 'containers') {
          renderContainers();
        } else if (state.navigationLevel === 'elements' && state.currentContainer) {
          renderContainerElements(state.currentContainer);
        }
      }, 50);
    });
  }
}

// Handle messages
function handleMessage(message, sender, sendResponse) {
  if (message.type === 'toggleBrowse') {
    if (message.enabled) activate();
    else deactivate();
  }

  if (message.type === 'settingsUpdate') {
    state.apiKey = message.apiKey;
    state.enabled = message.enabled;

    if (state.enabled && state.apiKey) activate();
    else deactivate();
  }

  if (message.type === 'saveSession') {
    saveSession(message.name);
  }

  if (message.type === 'loadSession') {
    loadSession(message.name);
  }

  return true;
}

// Keyboard handler
function handleKeyDown(e) {
  if (!state.active) return;

  // Always allow escape
  if (e.key === 'Escape') {
    e.preventDefault();
    handleEscape();
    return;
  }

  // Mode-specific handling FIRST (before other key checks)
  if (state.mode === MODES.FOLLOW) {
    handleFollowModeKeydown(e);
    return;
  }

  if (state.mode === MODES.COMMAND) {
    handleCommandPaletteKeydown(e);
    return;
  }

  // Command mode: Ctrl/Cmd + P
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    e.preventDefault();
    openCommandPalette();
    return;
  }

  // Follow mode: F (only if not already in follow mode)
  if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    enterFollowMode();
    return;
  }

  // Force reload: Shift+R (ignore cache)
  if (e.shiftKey && e.key === 'R' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    forceReload();
    return;
  }

  // Macro recording: Ctrl+Shift+R
  if (e.ctrlKey && e.shiftKey && e.key === 'R') {
    e.preventDefault();
    toggleMacroRecording();
    return;
  }

  // Save session: Ctrl+S
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    promptSaveSession();
    return;
  }

  // Container/Element navigation
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    const key = e.key.toLowerCase();

    // Check if key is one of our mapped shortcuts
    if (ALL_KEYS.toLowerCase().includes(key)) {
      e.preventDefault();

      if (state.keyToElement.has(key)) {
        const item = state.keyToElement.get(key);

        if (item.type === 'container') {
          // Enter container (zoom in)
          enterContainer(item.data);
        } else if (item.type === 'standalone' || item.type === 'element') {
          // Activate element directly
          activateElement(item.data, key);
        }
      }
    }
  }
}

// Handle escape
function handleEscape() {
  if (state.mode === MODES.FOLLOW) {
    exitFollowMode();
    return;
  }

  if (state.mode === MODES.COMMAND) {
    closeCommandPalette();
    return;
  }

  if (state.macroRecording) {
    stopMacroRecording(false);
    return;
  }

  // If inside a container, go back to container level
  if (state.navigationLevel === 'elements') {
    exitToContainers();
    return;
  }

  deactivate();
}

// Handle key up
function handleKeyUp(e) {
  // Could add visual feedback release here
}

// Handle mouse move for hover effects
function handleMouseMove(e) {
  if (!state.active || state.mode !== MODES.NORMAL) return;

  const element = document.elementFromPoint(e.clientX, e.clientY);
  if (!element || element === state.overlay) return;

  const annotation = findAnnotationForElement(element);
  if (annotation) {
    highlightAnnotation(annotation);
  }
}

// Enter follow mode
function enterFollowMode() {
  state.mode = MODES.FOLLOW;
  state.followModeInput = '';
  state.followModeSelectedIndex = 0;
  state.followModeMatches = [];
  updateHUD('Type to search. Arrow keys to navigate. ESC to exit.');
  renderFollowMode();
}

// Exit follow mode
function exitFollowMode() {
  state.mode = MODES.NORMAL;
  state.followModeInput = '';
  state.followModeSelectedIndex = 0;
  state.followModeMatches = [];

  // Clear follow mode UI
  clearFollowModeUI();

  // Return to current navigation level
  clearHints();
  if (state.navigationLevel === 'containers') {
    renderContainers();
  } else {
    renderContainerElements(state.currentContainer);
  }
}

// Handle follow mode keydown
function handleFollowModeKeydown(e) {
  // Arrow key navigation
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (state.followModeMatches.length === 0) return;

    if (e.key === 'ArrowDown') {
      state.followModeSelectedIndex = (state.followModeSelectedIndex + 1) % state.followModeMatches.length;
    } else {
      state.followModeSelectedIndex = (state.followModeSelectedIndex - 1 + state.followModeMatches.length) % state.followModeMatches.length;
    }

    updateFollowModeResults();
    return;
  }

  // Enter to activate selected match
  if (e.key === 'Enter') {
    e.preventDefault();
    if (state.followModeMatches.length > 0) {
      activateElement(state.followModeMatches[state.followModeSelectedIndex], 'follow');
      exitFollowMode();
    }
    return;
  }

  // Backspace
  if (e.key === 'Backspace') {
    e.preventDefault();
    state.followModeInput = state.followModeInput.slice(0, -1);
    state.followModeSelectedIndex = 0;
    updateFollowModeResults();
    return;
  }

  // Regular character input
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    state.followModeInput += e.key.toLowerCase();
    state.followModeSelectedIndex = 0;
    updateFollowModeResults();
  }
}

// Fuzzy match function with scoring
function fuzzyMatch(text, query) {
  text = text.toLowerCase();
  query = query.toLowerCase();

  if (!query) return { score: 0, match: false };

  // Exact match gets highest score
  if (text === query) return { score: 100, match: true };

  // Starts with query gets high score
  if (text.startsWith(query)) return { score: 80, match: true };

  // Contains query gets medium score
  if (text.includes(query)) return { score: 60, match: true, highlight: query };

  // Fuzzy match - character by character
  let textIndex = 0;
  let queryIndex = 0;
  let score = 0;
  let consecutiveMatches = 0;

  while (textIndex < text.length && queryIndex < query.length) {
    if (text[textIndex] === query[queryIndex]) {
      score += 10 + consecutiveMatches * 2; // Bonus for consecutive matches
      consecutiveMatches++;
      queryIndex++;
    } else {
      consecutiveMatches = 0;
      // Small penalty for skipping characters
      score -= 1;
    }
    textIndex++;
  }

  // Only return as match if we found all characters
  if (queryIndex === query.length) {
    return { score: Math.max(20, score), match: true };
  }

  return { score: 0, match: false };
}

// Find matches for follow mode with fuzzy matching
function findMatchesForFollow(query) {
  if (!query) return [];

  // Get all elements based on current navigation level
  let allElements = [];
  if (state.navigationLevel === 'containers') {
    state.containers.forEach(c => allElements.push({ ...c, type: 'container' }));
    state.standalone.forEach(s => allElements.push({ ...s, type: 'standalone' }));
  } else {
    state.currentElements.forEach(e => allElements.push({ ...e, type: 'element' }));
  }

  console.log('[Browse Follow] Searching', allElements.length, 'elements for:', query);

  // Score and filter with fuzzy matching
  const scored = allElements.map(element => {
    // Try to get element text using stored element reference first
    let el = element._element || queryElementSafe(element.selector);
    const text = element.label || (el ? getElementText(el) : '') || '';
    const result = fuzzyMatch(text, query);
    console.log('[Browse Follow] Match:', text, '->', result);
    return {
      element,
      score: result.score,
      match: result.match,
      text,
      highlight: result.highlight
    };
  }).filter(r => r.match && r.score > 0);

  console.log('[Browse Follow] Found', scored.length, 'matches');

  // Sort by score (highest first)
  scored.sort((a, b) => b.score - a.score);

  // Return top 9 matches
  return scored.slice(0, 9).map(s => s.element);
}

// Update follow mode results
function updateFollowModeResults() {
  // Clear previous follow mode UI
  clearFollowModeUI();

  if (!state.followModeInput) {
    renderFollowMode();
    return;
  }

  // Show input display
  showFollowModeInput();

  state.followModeMatches = findMatchesForFollow(state.followModeInput);

  if (state.followModeMatches.length > 0) {
    const selected = state.followModeMatches[state.followModeSelectedIndex];
    const selectedIndexText = state.followModeMatches.length > 1 ?
      ` [${state.followModeSelectedIndex + 1}/${state.followModeMatches.length}]` : '';

    updateHUD(`Searching: "${state.followModeInput}" • ${state.followModeMatches.length} match${state.followModeMatches.length > 1 ? 'es' : ''}${selectedIndexText} • ↑↓ navigate • Enter to select`);

    // Show hints for all matches with special highlight for selected
    state.keyToElement.clear();
    state.followModeMatches.forEach((annotation, i) => {
      const key = NUMBERS[i];
      state.keyToElement.set(key, annotation);

      // Add visual indicator for selected match
      const hint = showHintForElement(annotation, key);

      // Highlight selected match
      if (i === state.followModeSelectedIndex) {
        const hintEl = state.overlay.querySelector(`[data-key="${key}"]`);
        if (hintEl) {
          const inner = hintEl.querySelector('span');
          if (inner) {
            inner.style.border = '3px solid #FFD700';
            inner.style.boxShadow = '0 0 16px rgba(255, 215, 0, 0.8)';
            inner.style.transform = 'scale(1.1)';
          }
        }
      }
    });
  } else {
    updateHUD(`Searching: "${state.followModeInput}" • No matches found • Backspace to delete • Esc to exit`);
    state.keyToElement.clear();
  }
}

// Show follow mode input display at bottom of screen (above HUD)
function showFollowModeInput() {
  // Remove existing input display
  const existing = state.overlay?.querySelector('.browse-follow-input');
  if (existing) existing.remove();

  if (!state.overlay) return;

  const inputDisplay = document.createElement('div');
  inputDisplay.className = 'browse-follow-input';

  inputDisplay.innerHTML = `
    <div style="
      position: fixed;
      bottom: 70px;
      left: 50%;
      transform: translateX(-50%);
      background: ${COLORS.bg};
      border: 2px solid ${COLORS.primary};
      border-radius: 12px;
      padding: 16px 24px;
      z-index: 2147483650;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(16px);
      min-width: 400px;
      animation: browseInputReveal 0.25s ease-out;
    ">
      <div style="
        color: rgba(255, 255, 255, 0.6);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 8px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-weight: 600;
      ">Search</div>
      <div style="
        color: #fff;
        font-size: 24px;
        font-family: 'SF Mono', Monaco, monospace;
        font-weight: 600;
        min-height: 32px;
        display: flex;
        align-items: center;
      ">
        ${state.followModeInput || ''}<span style="
          display: inline-block;
          width: 2px;
          height: 24px;
          background: ${COLORS.primary};
          margin-left: 2px;
          animation: browseCursorBlink 1s step-end infinite;
        "></span>
      </div>
      <div style="
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.5);
        font-size: 12px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      ">
        ${state.followModeMatches.length > 0 ?
          `Found ${state.followModeMatches.length} match${state.followModeMatches.length > 1 ? 'es' : ''}` :
          'Type to search...'}
      </div>
    </div>
    <style>
      @keyframes browseCursorBlink {
        0%, 50% { opacity: 1; }
        51%, 100% { opacity: 0; }
      }
      @keyframes browseInputReveal {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }
    </style>
  `;

  state.overlay.appendChild(inputDisplay);
}

// Clear follow mode UI elements
function clearFollowModeUI() {
  const inputDisplay = state.overlay?.querySelector('.browse-follow-input');
  if (inputDisplay) inputDisplay.remove();
}

// Render follow mode
function renderFollowMode() {
  if (!state.overlay) return;

  // Show all links with their text hints
  state.annotations.forEach((annotation, i) => {
    if (i >= 9) return;
    const el = queryElementSafe(annotation.selector);
    if (!el) return;

    const key = NUMBERS[i];
    state.keyToElement.set(key, annotation);
    showHintForElement(annotation, key);
  });
}

// Activate extension
async function activate() {
  if (state.active) return;

  state.active = true;
  state.navigationLevel = 'containers';
  state.currentContainer = null;

  // Detect if this is a Gradio app
  state.isGradio = isGradioApp();
  state.gradioVersion = getGradioVersion();
  if (state.isGradio) {
    console.log('[Browse] Gradio app detected! Version:', state.gradioVersion);
  }

  createOverlay();

  // Show animated loading progress
  showLoadingProgress();

  const snapshot = generateDOMSnapshot();

  // Debug: Log snapshot info
  const containerElements = snapshot.elements.filter(e => e.isContainer);
  console.log('[Browse] Snapshot total elements:', snapshot.elements.length);
  console.log('[Browse] Container elements (isContainer:true):', containerElements.length);
  console.log('[Browse] Container element selectors:', containerElements.slice(0, 5).map(e => `${e.tag} - ${e.selector}`));

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'analyzePage',
      domSnapshot: snapshot
    });

    if (response.error) {
      hideLoadingProgress();
      showError(response.error);
      return;
    }

    state.containers = response.containers || [];
    state.standalone = response.standalone || [];

    // Debug: Log what we received
    console.log('[Browse] AI returned containers:', state.containers.length, 'standalone:', state.standalone.length);
    console.log('[Browse] Sample container data:', state.containers.slice(0, 3).map(c => ({
      label: c.label,
      selector: c.selector,
      elementsCount: c.elements?.length || 0
    })));
    console.log('[Browse] Sample standalone selectors:', state.standalone.slice(0, 3).map(s => s.selector));

    // Populate annotations for hover effects
    state.annotations = [...state.containers, ...state.standalone];

    hideLoadingProgress();

    if (state.containers.length === 0 && state.standalone.length === 0) {
      showError('No navigable elements found');
      return;
    }

    renderContainers();
    const total = state.containers.length + state.standalone.length;
    showHUD(`${state.containers.length} containers (1→9 workflow order) • 1-9: select • ?: help`);
  } catch (error) {
    hideLoadingProgress();
    showError(error.message);
  }
}

// Loading progress animation
let loadingProgressElement = null;
let loadingProgressStep = 0;
const loadingMessages = [
  'Scanning page structure...',
  'Finding containers...',
  'Analyzing elements...',
  'Almost there...'
];
let loadingInterval = null;

function showLoadingProgress() {
  if (!state.overlay) return;

  // Create loading HUD with background panel
  loadingProgressElement = document.createElement('div');
  loadingProgressElement.className = 'browse-loading-progress';
  loadingProgressElement.innerHTML = `
    <div class="browse-loading-panel">
      <div class="browse-loading-content">
        <div class="browse-loading-spinner"></div>
        <div class="browse-loading-text">${loadingMessages[0]}</div>
        <div class="browse-loading-progress-text">0%</div>
        <div class="browse-loading-dots">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>
    </div>
  `;

  loadingProgressElement.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483648;
    pointer-events: none;
  `;

  state.overlay.appendChild(loadingProgressElement);

  // Add styles
  const style = document.createElement('style');
  style.textContent = `
    .browse-loading-panel {
      background: ${COLORS.bg};
      border: 1px solid ${COLORS.border};
      border-radius: 16px;
      padding: 20px 32px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(20px);
    }

    .browse-loading-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
    }

    .browse-loading-spinner {
      width: 36px;
      height: 36px;
      border: 3px solid rgba(255, 255, 255, 0.15);
      border-top-color: ${COLORS.primary};
      border-radius: 50%;
      animation: browseSpin 0.8s linear infinite;
    }

    @keyframes browseSpin {
      to { transform: rotate(360deg); }
    }

    .browse-loading-text {
      color: ${COLORS.text};
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 15px;
      font-weight: 600;
      text-align: center;
      transition: opacity 0.2s ease;
    }

    .browse-loading-progress-text {
      color: rgba(255, 255, 255, 0.7);
      font-family: -apple-system, BlinkMacSystemFont, monospace;
      font-size: 13px;
      font-weight: 500;
    }

    .browse-loading-dots {
      display: flex;
      gap: 8px;
    }

    .browse-loading-dots .dot {
      width: 10px;
      height: 10px;
      background: ${COLORS.primary};
      border-radius: 50%;
      animation: browsePulse 1.4s ease-in-out infinite;
      box-shadow: 0 0 8px ${COLORS.primary};
    }

    .browse-loading-dots .dot:nth-child(2) {
      animation-delay: 0.2s;
    }

    .browse-loading-dots .dot:nth-child(3) {
      animation-delay: 0.4s;
    }

    @keyframes browsePulse {
      0%, 100% { opacity: 0.4; transform: scale(0.85); }
      50% { opacity: 1; transform: scale(1); }
    }
  `;

  loadingProgressElement.appendChild(style);

  // Cycle through messages and update progress percentage
  loadingProgressStep = 0;
  let progressPercent = 0;
  loadingInterval = setInterval(() => {
    // Check if element still exists (may have been removed)
    if (!loadingProgressElement) {
      clearInterval(loadingInterval);
      return;
    }

    // Update message
    loadingProgressStep = (loadingProgressStep + 1) % loadingMessages.length;
    const textEl = loadingProgressElement.querySelector('.browse-loading-text');
    if (textEl) {
      textEl.style.opacity = '0';
      setTimeout(() => {
        if (loadingProgressElement) {
          textEl.textContent = loadingMessages[loadingProgressStep];
          textEl.style.opacity = '1';
        }
      }, 200);
    }

    // Update progress percentage (ramp up to 85% max, leave room for actual completion)
    if (progressPercent < 85) {
      progressPercent += Math.random() * 15 + 5; // Add 5-20% per update
      if (progressPercent > 85) progressPercent = 85;
      const progressEl = loadingProgressElement.querySelector('.browse-loading-progress-text');
      if (progressEl) {
        progressEl.textContent = `${Math.floor(progressPercent)}%`;
      }
    }
  }, 1500);
}

function hideLoadingProgress() {
  if (loadingInterval) {
    clearInterval(loadingInterval);
    loadingInterval = null;
  }

  if (loadingProgressElement) {
    // Show 100% completion before hiding
    const progressEl = loadingProgressElement.querySelector('.browse-loading-progress-text');
    const textEl = loadingProgressElement.querySelector('.browse-loading-text');
    if (progressEl) progressEl.textContent = '100%';
    if (textEl) textEl.textContent = 'Complete!';

    // Fade out and remove
    loadingProgressElement.style.transition = 'opacity 0.3s ease-out';
    loadingProgressElement.style.opacity = '0';

    setTimeout(() => {
      if (loadingProgressElement) {
        loadingProgressElement.remove();
        loadingProgressElement = null;
      }
    }, 300);
  }
}

// Deactivate
function deactivate() {
  state.active = false;
  state.mode = MODES.NORMAL;
  state.navigationLevel = 'containers';

  if (state.overlay) {
    // Add fade-out animation
    state.overlay.classList.add('fade-out');

    // Remove after animation completes
    setTimeout(() => {
      if (state.overlay) {
        state.overlay.remove();
        state.overlay = null;
      }
    }, 250);
  }

  state.containers = [];
  state.standalone = [];
  state.annotations = [];
  state.currentContainer = null;
  state.currentElements = [];
  state.keyToElement.clear();
}

// Force reload
async function forceReload() {
  // Check if we're in container view
  if (state.navigationLevel === 'elements' && state.currentContainer) {
    // Refresh Vimium-style element finding (instant, no AI call)
    await reloadContainer();
  } else {
    // Re-analyze entire page with AI (finds containers and standalone elements)
    await reloadFullPage();
  }
}

// Reload full page
async function reloadFullPage() {
  // Clear cache for current page
  await chrome.runtime.sendMessage({ type: 'clearCache' });

  // Show loading animation
  showLoadingProgress();

  // Re-analyze
  const snapshot = generateDOMSnapshot();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'analyzePage',
      domSnapshot: snapshot
    });

    hideLoadingProgress();

    if (response.error) {
      showError(response.error);
      return;
    }

    state.containers = response.containers || [];
    state.standalone = response.standalone || [];

    // Populate annotations for hover effects
    state.annotations = [...state.containers, ...state.standalone];

    renderContainers();
    const total = state.containers.length + state.standalone.length;
    showHUD(`Reloaded: ${state.containers.length} containers (1→9 workflow order) • 1-9: select`);
  } catch (error) {
    hideLoadingProgress();
    showError(error.message);
  }
}

// Reload only current container
async function reloadContainer() {
  const container = state.currentContainer;
  if (!container) return;

  // Since we're using Vimium-style approach, just re-find elements (instant!)
  showHUD('Refreshing elements...');

  state.currentElements = findInteractiveElementsInContainer(container);

  // Re-render with new elements
  renderContainerElements(container);

  showHUD(`${state.currentElements.length} elements (a→z workflow order) • ESC: back`);
}

// Render containers (Level 1)
function renderContainers() {
  if (!state.overlay) return;

  clearHints();
  state.keyToElement.clear();

  // Filter out fake containers (AI sometimes identifies single elements as containers)
  // A real container should have multiple elements OR be a known semantic section
  const validContainers = state.containers.filter(container => {
    // Check if the container actually contains multiple elements
    const containerEl = queryElementSafe(container.selector);
    if (!containerEl) {
      console.log('[Browse] Filtered container with invalid selector:', container.label);
      return false;
    }

    // Count ALL elements within (not just interactive)
    const elementCount = containerEl.querySelectorAll('*').length;

    // Must have at least 2 elements to be considered a valid container
    const isValid = elementCount >= 2;

    if (!isValid) {
      console.log('[Browse] Filtered fake container:', container.label, 'only had', elementCount, 'elements');
    }

    return isValid;
  });

  console.log('[Browse] Valid containers:', validContainers.length, 'out of', state.containers.length);

  // Render containers with number hints
  validContainers.forEach((container, i) => {
    if (i >= 9) return;
    const key = NUMBERS[i];
    state.keyToElement.set(key, { type: 'container', data: container });
    showContainerHint(container, key);
  });

  // NOTE: Standalone elements are NOT shown at container level
  // They are only accessible when inside a container (vimium-style navigation)
}

// Show container hint with cute doodle/sketch style
function showContainerHint(container, key) {
  const element = queryElementSafe(container.selector);
  if (!element) return;

  const rect = element.getBoundingClientRect();
  const label = container.label || 'Container';

  // Calculate visibility factor to determine badge size
  const visibility = getVisibilityFactor(element);
  const isOffScreen = visibility < 0.3; // Less than 30% visible
  const sizeScale = isOffScreen ? 0.7 : 1.0; // 30% smaller for off-screen elements
  const opacity = isOffScreen ? 0.6 : 1.0; // More transparent for off-screen

  // Cute pastel color palette 🌸✨🌈
  const cuteColors = [
    { primary: '#DD7777', secondary: '#DDAA77', sparkle: '#CC8844' }, // Soft pink + peach
    { primary: '#77DD88', secondary: '#DDDD77', sparkle: '#CC4477' }, // Mint + yellow
    { primary: '#BB77DD', secondary: '#9966BB', sparkle: '#DD7744' }, // Lavender + purple
    { primary: '#77DDEE', secondary: '#77DDAA', sparkle: '#DD4488' }, // Sky blue + cyan
    { primary: '#DDAA88', secondary: '#BBDD88', sparkle: '#DD6699' }, // Peach + lime
    { primary: '#AA88DD', secondary: '#88DDAA', sparkle: '#DD8888' }, // Periwinkle + mint
  ];
  const colorIndex = parseInt(key) - 1;
  const colors = cuteColors[colorIndex % cuteColors.length];

  // Create gorgeous dimmed background overlay (first time only)
  if (!state.overlay.querySelector('.browse-dim-overlay')) {
    const dimOverlay = document.createElement('div');
    dimOverlay.className = 'browse-dim-overlay';
    dimOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(8, 8, 12, 0.4);
      backdrop-filter: blur(3px) saturate(1.1);
      z-index: 2147483640;
      pointer-events: none;
      animation: browseDimIn 0.5s ease-out;
    `;

    // Add sparkle stars
    const sparkleContainer = document.createElement('div');
    sparkleContainer.className = 'browse-sparkles';
    sparkleContainer.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 2147483641;
      overflow: hidden;
    `;

    // Generate 30 random sparkles
    for (let i = 0; i < 30; i++) {
      const sparkle = document.createElement('div');
      const size = Math.random() * 3 + 1;
      const x = Math.random() * 100;
      const y = Math.random() * 100;
      const delay = Math.random() * 3;
      const duration = Math.random() * 2 + 2;
      const colors = ['#22CC66', '#DDDD00', '#CC33BB', '#22AACC', '#888888'];
      const color = colors[Math.floor(Math.random() * colors.length)];

      sparkle.style.cssText = `
        position: absolute;
        left: ${x}%;
        top: ${y}%;
        width: ${size}px;
        height: ${size}px;
        background: ${color};
        border-radius: 50%;
        box-shadow: 0 0 ${size * 2}px ${color}, 0 0 ${size * 4}px ${color}60;
        animation: sparkle ${duration}s ease-in-out ${delay}s infinite;
        opacity: 0;
      `;
      sparkleContainer.appendChild(sparkle);
    }

    state.overlay.appendChild(dimOverlay);
    state.overlay.appendChild(sparkleContainer);
  }

  // Create cute doodle border
  const border = document.createElement('div');
  border.className = 'browse-container-border';
  border.setAttribute('data-container-key', key);

  // Generate a slightly "hand-drawn" path around the container
  const sketchPath = generateCuteSketchPath(rect.width, rect.height);

  border.innerHTML = `
    <svg style="
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      pointer-events: none;
      z-index: 2147483646;
      overflow: visible;
    ">
      <!-- Soft highlight marker effect (behind) -->
      <path d="${sketchPath.highlight}" fill="none" stroke="${colors.secondary}" stroke-width="18"
        stroke-linecap="round" opacity="0.25" />
      <!-- Hand-drawn sketchy border with multiple strokes -->
      <path d="${sketchPath.main}" fill="none" stroke="${colors.primary}" stroke-width="3"
        stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />
      <path d="${sketchPath.rough}" fill="none" stroke="${colors.primary}" stroke-width="1.5"
        stroke-linecap="round" stroke-linejoin="round" opacity="0.5" />
      <path d="${sketchPath.sketchy}" fill="none" stroke="${colors.accent || colors.primary}" stroke-width="1"
        stroke-linecap="round" stroke-linejoin="round" opacity="0.35" />
      <!-- Add cute sparkles ✨ -->
      ${generateSparkles(rect.width, rect.height, colors.sparkle)}
    </svg>
  `;

  state.overlay.appendChild(border);

  // Smart positioning for badge with flexible label width
  const baseBadgeWidth = 55;
  const baseBadgeHeight = 55;

  // Apply size scale based on visibility (30% smaller for off-screen)
  const badgeWidth = baseBadgeWidth * sizeScale;
  const badgeHeight = baseBadgeHeight * sizeScale;

  // Calculate more accurate label width (approximate 8px per character + padding)
  const labelWidth = Math.max(80, Math.min(400, Math.ceil(label.length * 9) + 40)) * sizeScale;
  const totalWidth = badgeWidth + labelWidth + 15;

  // Position preferences
  let badgeX, badgeY, arrowFromX, arrowFromY, arrowToX, arrowToY;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const padding = 20;

  // Try above first (preferred)
  if (rect.top - badgeHeight - 50 > padding) {
    badgeX = rect.left + rect.width / 2 - badgeWidth / 2;
    badgeY = rect.top - badgeHeight - 50;
    arrowFromX = badgeWidth / 2;
    arrowFromY = badgeHeight + 12;
    arrowToX = badgeWidth / 2;
    arrowToY = badgeHeight + 40;
  }
  // Try below if above doesn't fit
  else if (rect.bottom + badgeHeight + 50 < viewport.height - padding) {
    badgeX = rect.left + rect.width / 2 - badgeWidth / 2;
    badgeY = rect.bottom + 25;
    arrowFromX = badgeWidth / 2;
    arrowFromY = -12;
    arrowToX = badgeWidth / 2;
    arrowToY = 15;
  }
  // Try left side
  else if (rect.left - totalWidth - padding > padding) {
    badgeX = rect.left - totalWidth - 25;
    badgeY = rect.top + rect.height / 2 - badgeHeight / 2;
    arrowFromX = badgeWidth + labelWidth;
    arrowFromY = badgeHeight / 2;
    arrowToX = badgeWidth + labelWidth + 25;
    arrowToY = badgeHeight / 2;
  }
  // Fallback: right side
  else {
    badgeX = Math.min(rect.right + 25, viewport.width - totalWidth - padding);
    badgeY = Math.max(padding, Math.min(rect.top, viewport.height - badgeHeight - padding));
    arrowFromX = -12;
    arrowFromY = badgeHeight / 2;
    arrowToX = -40;
    arrowToY = badgeHeight / 2;
  }

  // Clamp to viewport
  badgeX = Math.max(padding, Math.min(badgeX, viewport.width - totalWidth - padding));
  badgeY = Math.max(padding, Math.min(badgeY, viewport.height - badgeHeight - padding));

  // Generate cute hand-drawn arrow
  const arrowPath = generateStraightArrow(arrowFromX, arrowFromY, arrowToX, arrowToY);

  // Create cute badge
  const badge = document.createElement('div');
  badge.className = 'browse-container-badge';
  badge.setAttribute('data-key', key);

  badge.innerHTML = `
    <svg style="
      position: fixed;
      left: ${badgeX}px;
      top: ${badgeY}px;
      width: ${totalWidth + 20}px;
      height: ${badgeHeight + 10}px;
      pointer-events: none;
      z-index: 2147483647;
      overflow: visible;
      transition: opacity 0.3s ease;
    ">
      <!-- Cute hand-drawn circle with soft glow -->
      <defs>
        <filter id="glow${key}">
          <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <circle cx="${badgeWidth / 2}" cy="${badgeHeight / 2}" r="${22 * sizeScale}"
        fill="${colors.primary}" stroke="#fff" stroke-width="${3 * sizeScale}" filter="url(#glow${key})" opacity="${0.95 * opacity}" />
      <!-- Inner decoration ring -->
      <circle cx="${badgeWidth / 2}" cy="${badgeHeight / 2}" r="${26 * sizeScale}"
        fill="none" stroke="${colors.secondary}" stroke-width="${1.5 * sizeScale}" opacity="${0.5 * opacity}"
        stroke-dasharray="3,4" />

      <!-- Cute key number with soft shadow -->
      <text x="${badgeWidth / 2}" y="${badgeHeight / 2 + 2}"
        text-anchor="middle" dominant-baseline="middle"
        font-family="'Comic Sans MS', 'Chalkboard SE', 'Varela Round', cursive, sans-serif"
        font-size="${28 * sizeScale}" font-weight="bold" fill="#fff" style="text-shadow: 2px 2px 6px rgba(0,0,0,0.2);">${key}</text>

      <!-- Cute arrow with softer look -->
      <path d="${arrowPath}" fill="none" stroke="${colors.secondary}"
        stroke-width="${5 * sizeScale}" stroke-linecap="round" stroke-linejoin="round" opacity="${0.85 * opacity}" />
      <path d="${arrowPath}" fill="none" stroke="${colors.primary}"
        stroke-width="${2.5 * sizeScale}" stroke-linecap="round" stroke-linejoin="round" />

      <!-- Cute label bubble with rounded corners - dark background for contrast -->
      <rect x="${badgeWidth + 12}" y="${(badgeHeight - 32 * sizeScale) / 2}" width="${labelWidth}" height="${32 * sizeScale}" rx="${10 * sizeScale}" ry="${10 * sizeScale}"
        fill="rgba(30, 30, 45, ${0.95 * opacity})" stroke="${colors.primary}" stroke-width="${2.5 * sizeScale}" />
      <text x="${badgeWidth + 12 + labelWidth / 2}" y="${badgeHeight / 2 + 1}"
        text-anchor="middle" dominant-baseline="middle"
        font-family="'Comic Sans MS', 'Chalkboard SE', 'Varela Round', cursive, sans-serif"
        font-size="${14 * sizeScale}" font-weight="600" fill="#ffffff"
        style="text-shadow: 0 0 8px rgba(0,0,0,0.5);">${escapeHtml(label)}</text>
    </svg>
  `;

  state.overlay.appendChild(badge);
}

// Generate a sketchy/hand-drawn path around a rectangle
function generateSketchPath(width, height) {
  const padding = 2;
  const w = width - padding * 2;
  const h = height - padding * 2;

  // Main path - slightly wobbly rectangle
  const main = `
    M ${padding + Math.random() * 3},${padding + Math.random() * 3}
    L ${width - padding - Math.random() * 3},${padding + Math.random() * 3}
    L ${width - padding - Math.random() * 3},${height - padding - Math.random() * 3}
    L ${padding + Math.random() * 3},${height - padding - Math.random() * 3}
    Z
  `;

  // Rough path - more wobbly, offset slightly
  const rough = `
    M ${padding + Math.random() * 6},${padding + Math.random() * 6}
    L ${width - padding - Math.random() * 6},${padding + Math.random() * 6}
    L ${width - padding - Math.random() * 6},${height - padding - Math.random() * 6}
    L ${padding + Math.random() * 6},${height - padding - Math.random() * 6}
    Z
  `;

  // Highlight - thick marker stroke
  const highlight = `
    M ${padding - 2},${padding - 2}
    L ${width - padding + 2},${padding - 2}
    L ${width - padding + 2},${height - padding + 2}
    L ${padding - 2},${height - padding + 2}
    Z
  `;

  return { main, rough, highlight };
}

// Generate a cute sketchy path with more hand-drawn character
function generateCuteSketchPath(width, height) {
  const padding = 2;
  const segments = 8; // More segments for more hand-drawn look

  // Generate wavy hand-drawn line helper
  const wavyLine = (x1, y1, x2, y2, wobble = 3) => {
    const midX = (x1 + x2) / 2 + (Math.random() - 0.5) * wobble;
    const midY = (y1 + y2) / 2 + (Math.random() - 0.5) * wobble;
    return `L ${midX},${midY} L ${x2},${y2}`;
  };

  // Corner points with randomness
  const p1 = { x: padding + (Math.random() - 0.5) * 6, y: padding + (Math.random() - 0.5) * 6 };
  const p2 = { x: width - padding + (Math.random() - 0.5) * 6, y: padding + (Math.random() - 0.5) * 6 };
  const p3 = { x: width - padding + (Math.random() - 0.5) * 6, y: height - padding + (Math.random() - 0.5) * 6 };
  const p4 = { x: padding + (Math.random() - 0.5) * 6, y: height - padding + (Math.random() - 0.5) * 6 };

  // Main stroke - primary hand-drawn line
  const main = `
    M ${p1.x},${p1.y}
    ${wavyLine(p1.x, p1.y, p2.x, p2.y, 4)}
    ${wavyLine(p2.x, p2.y, p3.x, p3.y, 4)}
    ${wavyLine(p3.x, p3.y, p4.x, p4.y, 4)}
    ${wavyLine(p4.x, p4.y, p1.x, p1.y, 4)}
  `;

  // Rough stroke - second pass with offset (like going over the line again)
  const offset1 = 2;
  const rough = `
    M ${p1.x + offset1},${p1.y + offset1}
    ${wavyLine(p1.x + offset1, p1.y + offset1, p2.x + offset1, p2.y - offset1, 6)}
    ${wavyLine(p2.x + offset1, p2.y - offset1, p3.x - offset1, p3.y - offset1, 6)}
    ${wavyLine(p3.x - offset1, p3.y - offset1, p4.x - offset1, p4.y + offset1, 6)}
    ${wavyLine(p4.x - offset1, p4.y + offset1, p1.x + offset1, p1.y + offset1, 6)}
  `;

  // Third pass - extra sketchy stroke
  const offset2 = -2;
  const sketchy = `
    M ${p1.x + offset2},${p1.y + offset2}
    ${wavyLine(p1.x + offset2, p1.y + offset2, p2.x + offset2, p2.y + offset2, 8)}
    ${wavyLine(p2.x + offset2, p2.y + offset2, p3.x + offset2, p3.y + offset2, 8)}
    ${wavyLine(p3.x + offset2, p3.y + offset2, p4.x + offset2, p4.y + offset2, 8)}
    ${wavyLine(p4.x + offset2, p4.y + offset2, p1.x + offset2, p1.y + offset2, 8)}
  `;

  // Highlight marker effect (softer, behind)
  const highlight = `
    M ${padding - 2},${padding - 2}
    L ${width - padding + 2},${padding - 2}
    L ${width - padding + 2},${height - padding + 2}
    L ${padding - 2},${height - padding + 2}
    Z
  `;

  return { main, rough, sketchy, highlight };
}

// Generate cute sparkles ✨
function generateSparkles(width, height, sparkleColor) {
  const sparkleCount = Math.floor(Math.random() * 3) + 2; // 2-4 sparkles
  let sparklesSvg = '';

  for (let i = 0; i < sparkleCount; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const size = Math.random() * 4 + 3; // 3-7px
    const rotation = Math.random() * 360;

    // Create sparkle shape (four-pointed star)
    const sparkle = `
      <g transform="translate(${x}, ${y}) rotate(${rotation})">
        <path d="M 0,-${size} L ${size * 0.3},-${size * 0.3} L ${size},0 L ${size * 0.3},${size * 0.3} L 0,${size} L -${size * 0.3},${size * 0.3} L -${size},0 L -${size * 0.3},-${size * 0.3} Z"
          fill="${sparkleColor}" opacity="0.6">
          <animate attributeName="opacity" values="0.6;1;0.6" dur="${2 + Math.random()}s" repeatCount="indefinite" />
        </path>
      </g>
    `;
    sparklesSvg += sparkle;
  }

  return sparklesSvg;
}

// Generate a straight hand-drawn arrow with arrowhead
function generateStraightArrow(fromX, fromY, toX, toY) {
  // Add slight randomness to make it look hand-drawn
  const wobble1 = (Math.random() - 0.5) * 2;
  const wobble2 = (Math.random() - 0.5) * 2;

  // Draw the shaft
  const shaft = `M ${fromX + wobble1},${fromY} L ${toX + wobble2},${toY}`;

  // Draw arrowhead
  const headSize = 8;
  const angle = Math.atan2(toY - fromY, toX - fromX);

  // Calculate arrowhead points
  const leftX = toX - headSize * Math.cos(angle - Math.PI / 6);
  const leftY = toY - headSize * Math.sin(angle - Math.PI / 6);
  const rightX = toX - headSize * Math.cos(angle + Math.PI / 6);
  const rightY = toY - headSize * Math.sin(angle + Math.PI / 6);

  const head = `M ${leftX},${leftY} L ${toX},${toY} L ${rightX},${rightY}`;

  return shaft + ' ' + head;
}

// Enter container (Level 2)
function enterContainer(container) {
  // Add to breadcrumb trail
  state.breadcrumbTrail.push({
    type: 'container',
    label: container.label,
    selector: container.selector,
    timestamp: Date.now()
  });

  state.currentContainer = container;
  state.navigationLevel = 'elements';

  // Scroll container into view if it's not visible
  const containerEl = queryElementSafe(container.selector);
  if (containerEl) {
    const rect = containerEl.getBoundingClientRect();
    const isVisible = (
      rect.top >= 0 &&
      rect.top < window.innerHeight &&
      rect.left >= 0 &&
      rect.left < window.innerWidth
    );

    if (!isVisible) {
      console.log('[Browse] Container not visible, scrolling into view:', container.label);
      containerEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // Remove dim overlay with fade out
  const dimOverlay = state.overlay?.querySelector('.browse-dim-overlay');
  if (dimOverlay) {
    dimOverlay.style.transition = 'opacity 0.25s ease-out';
    dimOverlay.style.opacity = '0';
    setTimeout(() => dimOverlay.remove(), 250);
  }

  // Use traditional Vimium-style approach: find ALL interactive elements in container
  state.currentElements = findInteractiveElementsInContainer(container);

  // Populate annotations for hover effects (container elements only when inside)
  state.annotations = state.currentElements;

  console.log('[Browse] Found', state.currentElements.length, 'interactive elements in', container.label);

  renderContainerElements(container);
}

// Traditional Vimium-style: find ALL interactive elements in a container
function findInteractiveElementsInContainer(container) {
  const containerEl = queryElementSafe(container.selector);
  if (!containerEl) return [];

  const elements = [];
  const seenElements = new WeakSet(); // Use WeakSet to track actual DOM elements

  // Define all interactive selectors to find (expanded for better coverage)
  const interactiveSelectors = [
    // Links and buttons
    'a[href]',
    'a',  // All anchors, even without href
    'button:not([disabled])',

    // Form elements
    'input:not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',

    // Elements with interaction attributes
    '[tabindex]:not([tabindex="-1"])',
    '[onclick]',
    '[onmousedown]',
    '[onmouseup]',

    // ARIA roles
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="checkbox"]',
    '[role="radio"]',

    // Editable content
    '[contenteditable="true"]',

    // Common interactive classes/patterns
    '[class*="button"]',
    '[class*="btn"]',
    '[class*="link"]',
    '[class*="click"]',
    '[data-action]',
    '[data-click]'
  ];

  console.log('[Browse] Searching for interactive elements in', container.label);

  // Find all matching elements within this container
  interactiveSelectors.forEach(selector => {
    try {
      const found = containerEl.querySelectorAll(selector);
      console.log('[Browse] Selector', selector, 'found', found.length, 'elements');

      found.forEach((el) => {
        // Skip duplicates using actual DOM element reference
        if (seenElements.has(el)) {
          console.log('[Browse] Skipping duplicate element');
          return;
        }

        // Skip if element is not visible
        if (!isVisible(el)) {
          console.log('[Browse] Skipping invisible element');
          return;
        }

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          console.log('[Browse] Skipping element with zero size');
          return;
        }

        // Mark as seen
        seenElements.add(el);

        // Try to generate a selector, but also store element reference as fallback
        const simpleSelector = generateSimpleSelector(el, containerEl);

        const text = getElementText(el);
        const label = text || el.getAttribute('aria-label') || el.getAttribute('title') || el.className || el.tagName.toLowerCase();

        elements.push({
          selector: simpleSelector,
          label: label.substring(0, 50), // Limit label length
          type: getElementType(el),
          // Store DOM element reference as fallback for activation
          _element: el
        });

        console.log('[Browse] Added element:', label, 'with selector:', simpleSelector);
      });
    } catch (e) {
      console.warn('[Browse] Error finding elements with selector:', selector, e);
    }
  });

  console.log('[Browse] Vimium-style found', elements.length, 'elements in', container.label);
  return elements;
}

// Generate a simple CSS selector for an element relative to its container
function generateSimpleSelector(element, container) {
  // Try multiple strategies to create a working selector

  // 1. If element has an ID, use it (most reliable)
  if (element.id) {
    return `#${element.id}`;
  }

  // 2. Build a path from container to element
  const path = [];
  let current = element;

  while (current && current !== container) {
    let selector = current.tagName.toLowerCase();

    // Add ID if available
    if (current.id) {
      selector += `#${current.id}`;
      path.unshift(selector);
      break;
    }

    // Add classes (max 2 to keep it reasonable)
    if (current.classList && current.classList.length > 0) {
      const classes = Array.from(current.classList).slice(0, 2);
      selector += '.' + classes.join('.');
    }

    // Add nth-child if no ID or classes
    if (!current.id && (!current.classList || current.classList.length === 0)) {
      const siblings = Array.from(current.parentElement?.children || []);
      const index = siblings.indexOf(current) + 1;
      selector += `:nth-child(${index})`;
    }

    path.unshift(selector);
    current = current.parentElement;

    // Limit path depth
    if (path.length >= 5) break;
  }

  return path.join(' > ');
}

// Get element type for classification
function getElementType(element) {
  const tag = element.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'input') {
    const type = element.type || 'text';
    if (type === 'submit' || type === 'button') return 'button';
    return 'input';
  }
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'select';
  return 'button'; // Default for clickable elements
}

// Render elements within selected container (Vimium-style - show ALL elements)
function renderContainerElements(container) {
  if (!state.overlay) return;

  clearHints();
  state.keyToElement.clear();

  // Highlight the active container
  const containerEl = queryElementSafe(container.selector);
  if (containerEl) {
    const rect = containerEl.getBoundingClientRect();

    const activeBorder = document.createElement('div');
    activeBorder.className = 'browse-active-container';
    activeBorder.style.cssText = `
      position: fixed;
      left: ${rect.left - 4}px;
      top: ${rect.top - 4}px;
      width: ${rect.width + 8}px;
      height: ${rect.height + 8}px;
      border: 2px solid ${COLORS.accent};
      border-radius: 12px;
      box-sizing: border-box;
      pointer-events: none;
      z-index: 2147483645;
      box-shadow: 0 0 20px rgba(255, 64, 129, 0.3);
    `;
    state.overlay.appendChild(activeBorder);
  }

  // VIMIUM-STYLE: Show ALL elements without filtering!
  console.log('[Browse] Vimium-style: Rendering', state.currentElements.length, 'elements');

  renderVimiumHintsUniversal(state.currentElements);

  // Show context-aware mini HUD instead of bottom HUD
  const visibleCount = Math.min(state.currentElements.length, ALL_KEYS.length);
  showMiniHUD(container, visibleCount);
}

// Universal vimium hints - works the same for ALL elements (no special cases)
function renderVimiumHintsUniversal(elements) {
  if (!state.overlay) return;

  clearHints();
  state.keyToElement.clear();

  const HINT_SIZE = 26;

  // Track selector usage to handle duplicate selectors
  const selectorUsage = new Map();

  // Collect valid elements
  const validElements = [];
  elements.forEach((element, i) => {
    if (i >= ALL_KEYS.length) return;

    // Track how many times we've used this selector
    const usageCount = selectorUsage.get(element.selector) || 0;
    selectorUsage.set(element.selector, usageCount + 1);

    // Get all matching elements for this selector
    const allMatches = document.querySelectorAll(element.selector);

    if (allMatches.length === 0) return;

    // Use the nth matching element based on usage count
    const el = allMatches[Math.min(usageCount, allMatches.length - 1)];

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    validElements.push({
      element,
      rect,
      key: ALL_KEYS[i],
      index: i,
      domElement: el
    });
  });

  // Sort by visual position (reading order)
  validElements.sort((a, b) => {
    const rowDiff = a.rect.top - b.rect.top;
    if (Math.abs(rowDiff) > 10) return rowDiff;
    return a.rect.left - b.rect.left;
  });

  validElements.forEach((item) => {
    const { element, rect, key, index, domElement } = item;

    // Store the actual DOM element reference
    element._element = domElement;

    // Map key to element
    state.keyToElement.set(key.toLowerCase(), { type: 'element', data: element });

    const isNumber = NUMBERS.includes(key);
    const isExtended = index >= NUMBERS.length + LETTERS.length;
    const color = isNumber ? COLORS.primary : (isExtended ? COLORS.accent : COLORS.secondary);

    // Place hint directly OVER the element (centered)
    const hintX = rect.left + (rect.width - HINT_SIZE) / 2;
    const hintY = rect.top + (rect.height - HINT_SIZE) / 2;

    // Create hint badge (centered on element)
    const hint = document.createElement('div');
    hint.className = 'browse-vimium-hint';
    hint.setAttribute('data-key', key);
    hint.setAttribute('data-selector', element.selector);

    hint.style.cssText = `
      position: fixed;
      left: ${hintX}px;
      top: ${hintY}px;
      width: ${HINT_SIZE}px;
      height: ${HINT_SIZE}px;
      background: ${color};
      color: #000;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'SF Mono', Monaco, 'Consolas', monospace;
      font-weight: 700;
      font-size: ${isNumber ? '14px' : '12px'};
      z-index: 2147483647;
      pointer-events: none;
      box-shadow: 0 0 4px ${color}40, 0 2px 6px rgba(0, 0, 0, 0.5);
      border: 2px solid rgba(255, 255, 255, 0.9);
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    `;
    hint.textContent = key;
    state.overlay.appendChild(hint);

    // Create EXACT bounding box (same position and size as element)
    const border = document.createElement('div');
    border.className = 'browse-element-border';
    border.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 2px solid ${color};
      border-radius: 4px;
      box-sizing: border-box;
      pointer-events: none;
      z-index: 2147483646;
      opacity: 1.0;
      background: transparent;
      box-shadow: 0 0 3px ${color}40;
    `;
    state.overlay.appendChild(border);
  });

  console.log('[Browse] Rendered', validElements.length, 'vimium hints (on target elements)');
}

// Filter out elements that are too close together (anti-crowding)
function filterCrowdedElements(elements, minDistance = 60) {
  const filtered = [];
  const occupiedPositions = [];

  elements.forEach(element => {
    const el = queryElementSafe(element.selector);
    if (!el) {
      console.log('[Browse] Skipping element with invalid selector:', element.selector);
      return;
    }

    const rect = el.getBoundingClientRect();

    // Skip elements with zero dimensions (hidden, collapsed, etc.)
    if (rect.width === 0 || rect.height === 0) {
      console.log('[Browse] Skipping element with zero dimensions:', element.label);
      return;
    }

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Check if this position is too close to existing elements
    // Use separate thresholds for horizontal and vertical to be smarter
    const tooClose = occupiedPositions.some(pos => {
      const dx = Math.abs(centerX - pos.x);
      const dy = Math.abs(centerY - pos.y);
      // Allow closer horizontal spacing (for navbars, etc.)
      // But require more vertical spacing
      return dx < minDistance * 0.6 && dy < minDistance * 0.8;
    });

    if (!tooClose) {
      filtered.push(element);
      occupiedPositions.push({ x: centerX, y: centerY });
    } else {
      console.log('[Browse] Filtered crowded element:', element.label, `at (${centerX.toFixed(0)}, ${centerY.toFixed(0)})`);
    }
  });

  console.log('[Browse] Filtered', filtered.length, 'elements from', elements.length, 'total');
  return filtered;
}

// Exit back to container level
function exitToContainers() {
  // Remove mini HUD
  const miniHud = state.overlay?.querySelector('.browse-mini-hud');
  if (miniHud) miniHud.remove();

  // Restore dim overlay with fade-in (only if it doesn't already exist)
  let dimOverlay = state.overlay?.querySelector('.browse-dim-overlay');
  if (!dimOverlay) {
    dimOverlay = document.createElement('div');
    dimOverlay.className = 'browse-dim-overlay';
    dimOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(8, 8, 12, 0.4);
      backdrop-filter: blur(3px) saturate(1.1);
      z-index: 2147483640;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.3s ease-in;
    `;
    state.overlay.appendChild(dimOverlay);

    // Add sparkle stars if they don't exist
    if (!state.overlay.querySelector('.browse-sparkles')) {
      const sparkleContainer = document.createElement('div');
      sparkleContainer.className = 'browse-sparkles';
      sparkleContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: 2147483641;
        overflow: hidden;
      `;

      for (let i = 0; i < 30; i++) {
        const sparkle = document.createElement('div');
        const size = Math.random() * 3 + 1;
        const x = Math.random() * 100;
        const y = Math.random() * 100;
        const delay = Math.random() * 3;
        const duration = Math.random() * 2 + 2;
        const colors = ['#22CC66', '#DDDD00', '#CC33BB', '#22AACC', '#888888'];
        const color = colors[Math.floor(Math.random() * colors.length)];

        sparkle.style.cssText = `
          position: absolute;
          left: ${x}%;
          top: ${y}%;
          width: ${size}px;
          height: ${size}px;
          background: ${color};
          border-radius: 50%;
          box-shadow: 0 0 ${size * 2}px ${color}, 0 0 ${size * 4}px ${color}60;
          animation: sparkle ${duration}s ease-in-out ${delay}s infinite;
          opacity: 0;
        `;
        sparkleContainer.appendChild(sparkle);
      }

      state.overlay.appendChild(sparkleContainer);
    }

    // Trigger fade in
    requestAnimationFrame(() => {
      dimOverlay.style.opacity = '1';
    });
  }

  // Update breadcrumb trail (remove last entry if it's the current container)
  if (state.breadcrumbTrail.length > 0) {
    state.breadcrumbTrail.pop();
  }

  state.currentContainer = null;
  state.currentElements = [];
  state.navigationLevel = 'containers';

  // Restore annotations to containers + standalone for hover effects
  state.annotations = [...state.containers, ...state.standalone];

  renderContainers();

  // Show breadcrumb HUD if we have history
  if (state.breadcrumbTrail.length > 0) {
    showBreadcrumbHUD();
  } else {
    showHUD(`${state.containers.length} containers (1→9 workflow order) • 1-9: select • esc: back`);
  }
}

// Generate DOM snapshot with smart prioritization
function generateDOMSnapshot() {
  const snapshot = {
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
    elements: [],
    isGradio: state.isGradio,
    gradioVersion: state.gradioVersion
  };

  // Element priorities (interactive elements)
  const priorities = {
    'button': 1000,
    '[role="button"]': 950,
    'a[href]': 900,
    'input:not([type="hidden"])': 850,
    'textarea': 840,
    'select': 830,
    '[onclick]': 700,
    '[contenteditable="true"]': 650,
    '[tabindex]': 600
  };

  // Container-like elements (sections that may contain multiple interactive elements)
  const containerSelectors = [
    // Semantic HTML5 elements
    'nav', 'header', 'main', 'footer', 'aside', 'section', 'article',
    // ARIA roles
    '[role="navigation"]', '[role="banner"]', '[role="main"]', '[role="complementary"]',
    // Common class patterns (div-based containers)
    '.nav', '.navbar', '.navigation', '.header', '.menu', '.sidebar',
    '.container', '.wrapper', '.content', '.main-content', '.page-content',
    '.sidebar', '.left-sidebar', '.right-sidebar', '.aside',
    '.top-bar', '.topbar', '.toolbar', '.control-bar',
    '.panel', '.card', '.widget', '.box', '.block',
    '.section', '.area', '.region', '.zone',
    // Common ID patterns
    '#nav', '#navbar', '#navigation', '#header', '#menu', '#sidebar',
    '#container', '#wrapper', '#content', '#main', '#main-content',
    '#sidebar', '#left-sidebar', '#right-sidebar',
    '#top-bar', '#topbar', '#toolbar',
    '#panel', '#section',
    // Data attributes commonly used for containers
    '[data-container]', '[data-section]', '[data-region]'
  ];

  // Add Gradio-specific selectors if this is a Gradio app
  if (state.isGradio) {
    console.log('[Browse] Adding Gradio-specific container selectors');
    // Prepend Gradio selectors for better priority
    containerSelectors.unshift(...GRADIO_CONTAINER_SELECTORS);
  }

  const elements = [];

  // For Gradio apps, add specific component detection first
  if (state.isGradio) {
    console.log('[Browse] Collecting Gradio-specific components');

    // Collect Gradio buttons (submit, clear, etc.)
    try {
      document.querySelectorAll('[class*="gradio-button"]').forEach(el => {
        if (!isVisible(el)) return;

        const rect = el.getBoundingClientRect();
        const text = getElementText(el);

        // Determine button type based on text
        let btnType = 'gradio-button';
        if (text.toLowerCase().includes('submit') || text.toLowerCase().includes('generate')) {
          btnType = 'gradio-submit-button';
        } else if (text.toLowerCase().includes('clear') || text.toLowerCase().includes('reset')) {
          btnType = 'gradio-clear-button';
        }

        elements.push({
          selector: generateSelector(el),
          text: text.substring(0, 100),
          tag: 'button',
          priority: GRADIO_COMPONENT_PRIORITIES[btnType] || 1100,
          attributes: {
            className: el.className?.substring(0, 100),
            text: text.substring(0, 50)
          },
          position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          isGradioComponent: true
        });
      });
    } catch (e) {}

    // Collect Gradio form components (inputs, textareas, etc.)
    try {
      document.querySelectorAll('[class*="gradio-"]').forEach(el => {
        if (!isVisible(el)) return;
        const selector = generateSelector(el);
        // Skip if already collected (avoid duplicates)
        if (elements.some(e => e.selector === selector)) return;

        const rect = el.getBoundingClientRect();
        const text = getElementText(el);

        // Find input/textarea/select within the component wrapper
        const input = el.querySelector('input, textarea, select');

        elements.push({
          selector: input ? generateSelector(input) : selector,
          text: text.substring(0, 100),
          tag: input ? input.tagName.toLowerCase() : 'div',
          priority: 900, // High priority for Gradio components
          isContainer: !input, // Treat wrapper as container if no direct input
          attributes: {
            className: el.className?.substring(0, 100),
            placeholder: input?.placeholder,
            type: input?.type
          },
          position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          isGradioComponent: true
        });
      });
    } catch (e) {}

    console.log('[Browse] Collected', elements.filter(e => e.isGradioComponent).length, 'Gradio components');
  }

  // First, collect container elements with lower priority
  containerSelectors.forEach(selector => {
    try {
      document.querySelectorAll(selector).forEach(el => {
        if (!isVisible(el)) return;

        const rect = el.getBoundingClientRect();

        // Only include if it contains multiple interactive elements (relaxed from 2 to 1)
        const interactiveCount = el.querySelectorAll('button, a[href], input, textarea, select, [role="button"]').length;
        if (interactiveCount < 1) return; // Reduced from 2 to 1 to catch more containers

        // Skip if too large (likely the whole page) - relaxed slightly
        if (rect.width > window.innerWidth * 0.95 || rect.height > window.innerHeight * 0.85) return;

        elements.push({
          selector: generateSelector(el),
          text: getElementText(el).substring(0, 100),
          tag: el.tagName.toLowerCase(),
          priority: 400, // Lower priority than interactive elements
          isContainer: true,
          attributes: {
            id: el.id,
            className: el.className?.substring(0, 100),
            role: el.role
          },
          position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        });
      });
    } catch (e) {}
  });

  // ALSO include generic divs that could be containers (let AI decide)
  // Scan for divs with multiple interactive elements, regardless of class
  try {
    document.querySelectorAll('div').forEach(el => {
      if (!isVisible(el)) return;

      // Skip if already matched by container selectors
      const selector = generateSelector(el);
      if (elements.some(e => e.selector === selector)) return;

      const rect = el.getBoundingClientRect();

      // Must contain multiple interactive elements (reduced from 3 to 2)
      const interactiveCount = el.querySelectorAll('button, a[href], input, textarea, select, [role="button"]').length;
      if (interactiveCount < 2) return; // Reduced from 3 to 2 to catch more containers

      // Relaxed size constraints - allow smaller containers
      if (rect.width < 60 || rect.height < 30) return; // Reduced from 100x50
      if (rect.width > window.innerWidth * 0.98 || rect.height > window.innerHeight * 0.95) return; // Slightly relaxed

      // Skip if it's just a wrapper for a single element
      const children = el.children.length;
      if (children < 2) return;

      elements.push({
        selector: selector,
        text: getElementText(el).substring(0, 100),
        tag: 'div',
        priority: 300, // Even lower priority
        isContainer: true,
        attributes: {
          id: el.id,
          className: el.className?.substring(0, 100)
        },
        position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      });
    });
  } catch (e) {}

  // Then, collect interactive elements with priority scoring
  Object.entries(priorities).forEach(([selector, priority]) => {
    try {
      document.querySelectorAll(selector).forEach(el => {
        if (!isVisible(el)) return;

        const rect = el.getBoundingClientRect();
        const text = getElementText(el);

        // Score calculation
        let score = priority;
        if (text && text.length > 0 && text.length < 50) score += 100;
        if (rect.width > 40 && rect.height > 20) score += 50;

        elements.push({
          selector: generateSelector(el),
          text: text.substring(0, 100),
          tag: el.tagName.toLowerCase(),
          priority: score,
          attributes: {
            id: el.id,
            className: el.className?.substring(0, 100),
            href: el.href?.substring(0, 200),
            type: el.type,
            role: el.role,
            placeholder: el.placeholder,
            name: el.name
          },
          position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        });
      });
    } catch (e) {}
  });

  // Sort and limit - collect many more candidates for AI to choose from
  elements.sort((a, b) => b.priority - a.priority);
  snapshot.elements = elements.slice(0, 500); // Increased to 500 to get more containers

  console.log('[Browse] Collected', elements.length, 'elements (', snapshot.elements.filter(e => e.isContainer).length, 'containers)');

  return snapshot;
}

// Generate DOM snapshot for a specific container
function generateContainerSnapshot(container) {
  const containerEl = queryElementSafe(container.selector);
  if (!containerEl) {
    return {
      url: window.location.href,
      title: document.title,
      containerLabel: container.label,
      containerType: container.type,
      elements: []
    };
  }

  const snapshot = {
    url: window.location.href,
    title: document.title,
    containerLabel: container.label,
    containerType: container.type,
    elements: []
  };

  // Element priorities (same as full snapshot)
  const priorities = {
    'button': 1000,
    '[role="button"]': 950,
    'a[href]': 900,
    'input:not([type="hidden"])': 850,
    'textarea': 840,
    'select': 830,
    '[onclick]': 700,
    '[contenteditable="true"]': 650,
    '[tabindex]': 600
  };

  // Get elements within this container only
  const elements = [];

  Object.entries(priorities).forEach(([selector, priority]) => {
    try {
      containerEl.querySelectorAll(selector).forEach(el => {
        if (!isVisible(el)) return;

        const rect = el.getBoundingClientRect();
        const text = getElementText(el);

        // Score calculation
        let score = priority;
        if (text && text.length > 0 && text.length < 50) score += 100;
        if (rect.width > 40 && rect.height > 20) score += 50;

        elements.push({
          selector: generateSelector(el),
          text: text.substring(0, 100),
          tag: el.tagName.toLowerCase(),
          priority: score,
          attributes: {
            id: el.id,
            className: el.className?.substring(0, 100),
            href: el.href?.substring(0, 200),
            type: el.type,
            role: el.role,
            placeholder: el.placeholder,
            name: el.name
          },
          position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        });
      });
    } catch (e) {}
  });

  // Sort and limit - get all elements for the container (no artificial limit)
  elements.sort((a, b) => b.priority - a.priority);
  snapshot.elements = elements.slice(0, 200); // Increased from 20 to 200

  console.log('[Browse] Container snapshot generated with', snapshot.elements.length, 'elements');

  return snapshot;
}

// Determine element importance (high, medium, low)
function getElementImportance(annotation, element) {
  const text = (annotation.text || element.textContent || '').toLowerCase();
  const tag = element.tagName.toLowerCase();
  const type = element.type || '';
  const role = element.getAttribute('role') || '';

  // High importance: Primary actions, CTAs
  const highPriorityKeywords = [
    'submit', 'save', 'confirm', 'checkout', 'buy', 'purchase', 'order',
    'sign up', 'register', 'login', 'sign in', 'continue', 'next', 'done',
    'apply', 'accept', 'agree', 'proceed', 'complete', 'finish'
  ];

  const hasHighKeyword = highPriorityKeywords.some(keyword => text.includes(keyword));
  const isPrimaryButton = tag === 'button' && (
    element.classList.contains('btn-primary') ||
    element.classList.contains('primary') ||
    element.classList.contains('btn-lg') ||
    type === 'submit'
  );

  if (hasHighKeyword || isPrimaryButton) {
    return 'high';
  }

  // Medium importance: Secondary actions, navigation, important inputs
  const mediumPriorityKeywords = [
    'add', 'create', 'new', 'edit', 'update', 'delete', 'remove',
    'cancel', 'close', 'back', 'return', 'search', 'find', 'filter'
  ];

  const hasMediumKeyword = mediumPriorityKeywords.some(keyword => text.includes(keyword));
  const isSecondaryButton = tag === 'button' || role === 'button';
  const isImportantInput = ['email', 'password', 'username', 'name'].includes(type);

  if (hasMediumKeyword || isSecondaryButton || isImportantInput) {
    return 'medium';
  }

  // Low importance: Everything else
  return 'low';
}

// Determine action type for color coding
function getActionType(annotation, element) {
  const text = (annotation.text || element.textContent || '').toLowerCase();
  const tag = element.tagName.toLowerCase();
  const href = element.href || '';

  // Destructive actions
  const destructiveKeywords = ['delete', 'remove', 'cancel', 'destroy', 'discard'];
  if (destructiveKeywords.some(k => text.includes(k))) {
    return 'destructive';
  }

  // Primary actions
  const primaryKeywords = ['submit', 'save', 'confirm', 'checkout', 'buy', 'sign up', 'login'];
  if (primaryKeywords.some(k => text.includes(k))) {
    return 'primary';
  }

  // Navigation
  if (tag === 'a' && href) {
    // Check if external link
    if (href.startsWith('http') && !href.includes(window.location.hostname)) {
      return 'external';
    }
    return 'navigation';
  }

  // Form inputs
  if (['input', 'textarea', 'select'].includes(tag)) {
    return 'input';
  }

  return 'secondary';
}

// Get color based on action type and importance
function getColorForAction(actionType, importance, isNumber) {
  const colors = {
    // Action type colors
    primary: '#22BB66',      // Green for primary/CTA
    destructive: '#DD4444',  // Red for destructive
    navigation: '#4488DD',   // Blue for navigation
    external: '#8844DD',     // Purple for external links
    input: '#DD8844',        // Orange for inputs
    secondary: '#DDDD00'     // Yellow for secondary
  };

  // For high importance, use the action type color
  if (importance === 'high') {
    return colors[actionType] || colors.primary;
  }

  // For medium/low, use number vs letter distinction
  return isNumber ? COLORS.primary : COLORS.secondary;
}

// Get size based on importance
function getSizeForImportance(importance, isNumber) {
  const sizes = {
    high: {
      padding: '4px 8px',
      borderRadius: '6px',
      fontWeight: '800',
      fontSize: isNumber ? '15px' : '14px'
    },
    medium: {
      padding: '3px 7px',
      borderRadius: '5px',
      fontWeight: '700',
      fontSize: isNumber ? '14px' : '13px'
    },
    low: {
      padding: '2px 6px',
      borderRadius: '4px',
      fontWeight: '600',
      fontSize: isNumber ? '13px' : '12px'
    }
  };

  return sizes[importance] || sizes.low;
}

// Get animation for importance level
function getAnimationForImportance(importance) {
  if (importance === 'high') {
    return 'animation: browseHintReveal 0.3s ease-out, browsePulse 2s ease-in-out infinite;';
  }
  if (importance === 'medium') {
    return 'animation: browseHintReveal 0.3s ease-out;';
  }
  return 'animation: browseHintReveal 0.25s ease-out;';
}

// Calculate smart hint position to keep it visible on screen
function getSmartHintPosition(elementRect, hintSize = { width: 24, height: 24 }) {
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight
  };

  const padding = 8; // Minimum padding from viewport edges
  const offset = 4; // Small offset from element edge

  // Consistent positioning: always place hint at top-left of element
  // This makes it predictable and reduces overlaps
  let x = elementRect.left + offset;
  let y = elementRect.top + offset;

  // Clamp to viewport boundaries
  x = Math.max(padding, Math.min(x, viewport.width - hintSize.width - padding));
  y = Math.max(padding, Math.min(y, viewport.height - hintSize.height - padding));

  return { x, y, name: 'top-left' };
}

// Show hint for element
function showHintForElement(annotation, key, type = 'auto') {
  // Try using selector first, fall back to stored element reference
  let element = queryElementSafe(annotation.selector);

  // If selector fails and we have a stored element reference, use it
  if (!element && annotation._element) {
    element = annotation._element;
    // Verify the element is still in the DOM
    if (!document.contains(element)) {
      console.warn('[Browse] Stored element no longer in DOM:', annotation.label);
      return;
    }
  }

  if (!element) {
    console.warn('[Browse] Could not find element for:', annotation.label, 'with selector:', annotation.selector);
    return;
  }

  const rect = element.getBoundingClientRect();
  const isNumber = NUMBERS.includes(key);

  // Calculate visibility factor to determine hint size
  const visibility = getVisibilityFactor(element);
  const isOffScreen = visibility < 0.3; // Less than 30% visible
  const sizeScale = isOffScreen ? 0.7 : 1.0; // 30% smaller for off-screen elements
  const elementOpacity = isOffScreen ? 0.6 : 1.0; // More transparent for off-screen

  // Determine element importance and action type
  const importance = getElementImportance(annotation, element);
  const actionType = getActionType(annotation, element);

  // Get color based on action type and importance
  const color = getColorForAction(actionType, importance, isNumber);
  const size = getSizeForImportance(importance, isNumber);
  const animation = getAnimationForImportance(importance);

  // Estimate hint size for positioning
  const hintSize = isNumber ? { width: 20 * sizeScale, height: 20 * sizeScale } : { width: 24 * sizeScale, height: 24 * sizeScale };

  // Calculate smart position
  const position = getSmartHintPosition(rect, hintSize);

  const hint = document.createElement('div');
  hint.className = `browse-hint browse-hint-${importance} smooth-transition`;
  hint.setAttribute('data-key', key);
  hint.setAttribute('data-selector', annotation.selector);
  hint.setAttribute('data-importance', importance);
  hint.setAttribute('data-action', actionType);
  hint.setAttribute('data-position', position.name);

  hint.innerHTML = `<span>${key}</span>`;

  hint.style.cssText = `
    position: fixed;
    left: ${position.x}px;
    top: ${position.y}px;
    transform: none;
    z-index: 2147483647;
    pointer-events: none;
    ${animation}
  `;

  // Apply styles based on importance and type
  const hintInner = hint.querySelector('span');
  hintInner.style.cssText = `
    display: inline-block;
    background: ${color};
    color: #000;
    padding: ${size.padding};
    border-radius: ${size.borderRadius};
    font-family: 'SF Mono', Monaco, 'Consolas', monospace;
    font-weight: ${size.fontWeight};
    font-size: ${size.fontSize};
    transform: scale(${sizeScale});
    transform-origin: center center;
    opacity: ${elementOpacity};
    box-shadow: 0 ${importance === 'high' ? '4' : '2'}px ${importance === 'high' ? '12' : '8'}px rgba(0, 0, 0, 0.${importance === 'high' ? '4' : '3'});
    border: 1px solid rgba(255, 255, 255, 0.${importance === 'high' ? '7' : '5'});
    ${importance === 'high' ? 'animation: browsePulse 2s ease-in-out infinite;' : ''}
    min-width: ${20 * sizeScale}px;
    text-align: center;
    line-height: 1;
    transition: transform 0.3s ease, opacity 0.3s ease;
  `;

  state.overlay.appendChild(hint);

  // Add border to element
  const border = document.createElement('div');
  border.className = 'browse-hint-border';
  border.setAttribute('data-for', key);
  border.setAttribute('data-importance', importance);

  border.style.cssText = `
    position: fixed;
    left: ${rect.left}px;
    top: ${rect.top}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    border: ${importance === 'high' ? '3' : '2'}px solid ${color};
    border-radius: 4px;
    box-sizing: border-box;
    pointer-events: none;
    z-index: 2147483646;
    opacity: ${0.5 * elementOpacity};
    transition: opacity 0.3s ease;
  `;

  state.overlay.appendChild(border);
}

// Clear hints
function clearHints() {
  if (!state.overlay) return;

  state.overlay.querySelectorAll('.browse-hint, .browse-hint-border, .browse-container-border, .browse-container-badge, .browse-active-container, .browse-vimium-hint, .browse-element-border, .browse-sparkles').forEach(el => {
    el.remove();
  });
}

// Highlight annotation
function highlightAnnotation(annotation) {
  // Could add special highlight effect
}

// Activate element
function activateElement(annotation, key) {
  // Try using selector first, fall back to stored element reference
  let element = queryElementSafe(annotation.selector);

  // If selector fails and we have a stored element reference, use it
  if (!element && annotation._element) {
    element = annotation._element;
    // Verify the element is still in the DOM
    if (!document.contains(element)) {
      console.warn('[Browse] Stored element no longer in DOM, cannot activate:', annotation.label);
      showHUD('Element no longer available');
      return;
    }
  }

  if (!element) {
    console.warn('[Browse] Could not find element to activate:', annotation.label);
    showHUD('Could not find element');
    return;
  }

  // Track as recent element
  state.recentElements.add(annotation.selector);

  // Keep only last 10 recent elements
  if (state.recentElements.size > 10) {
    const first = state.recentElements.values().next().value;
    state.recentElements.delete(first);
  }

  // Show recent highlight animation
  highlightRecentElement(annotation.selector);

  // Record to macro if recording
  if (state.macroRecording) {
    state.currentMacro.push({
      type: 'click',
      selector: annotation.selector,
      url: window.location.href,
      timestamp: Date.now()
    });
  }

  // Hide the hint
  hideHint(key);

  // Apply visual feedback
  element.style.transition = 'all 0.15s ease';
  element.style.boxShadow = '0 0 0 4px rgba(0, 230, 118, 0.6)';

  setTimeout(() => {
    element.style.boxShadow = '';
  }, 300);

  // Scroll into view if needed
  const rect = element.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > window.innerHeight) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Activate
  setTimeout(() => {
    const elementType = annotation.type || element.tagName.toLowerCase();
    if (elementType === 'input' || elementType === 'textarea') {
      element.focus();
      element.click();
    } else if (element.href) {
      window.location.href = element.href;
    } else {
      element.click();
    }
  }, 150);
}

// Hide hint for key
function hideHint(key) {
  const hint = state.overlay?.querySelector(`[data-key="${key}"]`);
  const border = state.overlay?.querySelector(`[data-for="${key}"]`);

  if (hint) {
    hint.style.opacity = '0';
    hint.style.transition = 'opacity 0.2s ease';
  }

  if (border) {
    border.style.opacity = '0.1';
  }
}

// Create overlay
function createOverlay() {
  if (state.overlay) return;

  state.overlay = document.createElement('div');
  state.overlay.id = 'browse-overlay';
  state.overlay.className = 'browse-overlay';
  state.overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2147483647;
    overflow: visible;
  `;

  document.body.appendChild(state.overlay);
}

// Show context-aware mini HUD near container
function showMiniHUD(container, elementCount) {
  if (!state.overlay) return;

  // Remove existing mini HUD
  const existingHud = state.overlay.querySelector('.browse-mini-hud');
  if (existingHud) existingHud.remove();

  // Remove existing breadcrumb HUD
  const existingBreadcrumb = state.overlay.querySelector('.browse-breadcrumb-hud');
  if (existingBreadcrumb) existingBreadcrumb.remove();

  // Remove existing bottom HUD
  const existingBottomHud = state.overlay.querySelector('.browse-hud');
  if (existingBottomHud) existingBottomHud.remove();

  // Create mini HUD positioned at bottom
  const miniHud = document.createElement('div');
  miniHud.className = 'browse-mini-hud';

  miniHud.style.cssText = `
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    background: ${COLORS.bg};
    border: 1px solid ${COLORS.border};
    border-radius: 16px;
    padding: 16px 24px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1);
    z-index: 2147483648;
    pointer-events: none;
    backdrop-filter: blur(16px);
    display: flex;
    align-items: center;
    gap: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
  `;

  miniHud.innerHTML = `
    <div class="browse-mini-hud-left">
      <div class="browse-mini-hud-title">${escapeHtml(container.label)}</div>
      <div class="browse-mini-hud-stats">${elementCount} elements</div>
    </div>
    <div class="browse-mini-hud-divider"></div>
    <div class="browse-mini-hud-right">
      <div class="browse-mini-hud-keys">
        <span class="browse-key-hint">1-9</span>
        <span class="browse-key-hint">a-z</span>
        <span class="browse-key-hint">A-Z</span>
      </div>
      <div class="browse-mini-hud-esc">ESC to go back</div>
    </div>
  `;

  state.overlay.appendChild(miniHud);
}

// Show breadcrumb trail HUD
function showBreadcrumbHUD() {
  if (!state.overlay || state.breadcrumbTrail.length === 0) return;

  // Remove existing breadcrumb HUD
  const existingBreadcrumb = state.overlay.querySelector('.browse-breadcrumb-hud');
  if (existingBreadcrumb) existingBreadcrumb.remove();

  // Remove mini HUD if showing
  const existingMini = state.overlay.querySelector('.browse-mini-hud');
  if (existingMini) existingMini.remove();

  const breadcrumb = document.createElement('div');
  breadcrumb.className = 'browse-breadcrumb-hud';

  breadcrumb.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${COLORS.bg};
    border: 1px solid ${COLORS.border};
    border-radius: 10px;
    padding: 10px 20px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    z-index: 2147483648;
    pointer-events: none;
    backdrop-filter: blur(10px);
    display: flex;
    align-items: center;
    gap: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: ${COLORS.text};
  `;

  // Build breadcrumb HTML
  let breadcrumbHtml = '';
  state.breadcrumbTrail.forEach((crumb, index) => {
    if (index > 0) {
      breadcrumbHtml += `<span class="browse-breadcrumb-separator">→</span>`;
    }
    breadcrumbHtml += `<span class="browse-breadcrumb-item">${escapeHtml(crumb.label)}</span>`;
  });

  breadcrumb.innerHTML = breadcrumbHtml;
  state.overlay.appendChild(breadcrumb);
}

// Show tooltip on hint hover
function showTooltip(element, annotation) {
  if (!state.overlay) return;

  // Remove existing tooltip
  hideTooltip();

  const tooltip = document.createElement('div');
  tooltip.className = 'browse-tooltip';

  const rect = element.getBoundingClientRect();

  tooltip.style.cssText = `
    position: fixed;
    left: ${rect.left + rect.width / 2}px;
    top: ${rect.top - 8}px;
    transform: translateX(-50%) translateY(-100%);
    background: ${COLORS.bg};
    border: 1px solid ${COLORS.border};
    border-radius: 8px;
    padding: 10px 16px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    z-index: 2147483649;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: ${COLORS.text};
    white-space: nowrap;
    text-align: center;
    width: auto;
    min-width: 80px;
    max-width: 400px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease;
    overflow: visible;
  `;

  tooltip.textContent = annotation.label || 'Element';
  state.overlay.appendChild(tooltip);
  state.activeTooltip = tooltip;

  // Fade in
  requestAnimationFrame(() => {
    tooltip.style.opacity = '1';
  });
}

// Hide tooltip
function hideTooltip() {
  if (state.activeTooltip) {
    state.activeTooltip.remove();
    state.activeTooltip = null;
  }
}

// Highlight recently used element
function highlightRecentElement(selector) {
  if (!state.overlay) return;

  const element = queryElementSafe(selector);
  if (!element) return;

  const rect = element.getBoundingClientRect();

  const highlight = document.createElement('div');
  highlight.className = 'browse-recent-highlight';
  highlight.setAttribute('data-selector', selector);

  highlight.style.cssText = `
    position: fixed;
    left: ${rect.left}px;
    top: ${rect.top}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    border: 2px solid #FFD700;
    border-radius: 6px;
    box-sizing: border-box;
    pointer-events: none;
    z-index: 2147483645;
    box-shadow: 0 0 12px rgba(255, 215, 0, 0.4);
    animation: browseRecentHighlight 1s ease-out forwards;
  `;

  state.overlay.appendChild(highlight);

  // Auto-remove after animation
  setTimeout(() => {
    highlight.remove();
  }, 1000);
}

// HUD and UI
function showHUD(message) {
  if (!state.overlay) return;

  let hud = state.overlay.querySelector('.browse-hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.className = 'browse-hud';
    state.overlay.appendChild(hud);
  }

  hud.textContent = message;
  hud.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${COLORS.bg};
    color: ${COLORS.text};
    padding: 12px 24px;
    border-radius: 30px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    border: 1px solid ${COLORS.border};
    backdrop-filter: blur(10px);
    z-index: 2147483648;
    pointer-events: none;
  `;
}

function updateHUD(message) {
  showHUD(message);
}

function hideHUD() {
  const hud = state.overlay?.querySelector('.browse-hud');
  if (hud) hud.remove();
}

function showError(message) {
  if (!state.overlay) return;

  const error = document.createElement('div');
  error.className = 'browse-error';
  error.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <span style="font-size:24px;">⚠</span>
      <span>${escapeHtml(message)}</span>
      <button onclick="this.closest('.browse-error').remove()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;padding:8px 12px;border-radius:4px;cursor:pointer;pointer-events:auto;">✕</button>
    </div>
  `;

  error.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: linear-gradient(135deg, rgba(244, 67, 54, 0.95), rgba(211, 47, 47, 0.95));
    color: #fff;
    padding: 20px 24px;
    border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
    z-index: 2147483649;
    pointer-events: none;
  `;

  state.overlay.appendChild(error);
}

// Command Palette
function openCommandPalette() {
  state.mode = MODES.COMMAND;

  const palette = document.createElement('div');
  palette.className = 'browse-command-palette';
  palette.innerHTML = `
    <div class="browse-palette-overlay" onclick="closeCommandPalette()">
      <div class="browse-palette-content" onclick="event.stopPropagation()">
        <input type="text" class="browse-palette-input" placeholder="Type a command..." autofocus>
        <div class="browse-palette-results">
          <div class="browse-palette-item" data-action="reload">
            <span class="browse-palette-key">Shift+R</span>
            <span class="browse-palette-desc">Force reload - re-analyze page</span>
          </div>
          <div class="browse-palette-divider"></div>
          <div class="browse-palette-item" data-action="follow">
            <span class="browse-palette-key">F</span>
            <span class="browse-palette-desc">Follow mode - search links by typing</span>
          </div>
          <div class="browse-palette-item" data-action="record">
            <span class="browse-palette-key">Ctrl+Shift+R</span>
            <span class="browse-palette-desc">Record macro - sequence of actions</span>
          </div>
          <div class="browse-palette-item" data-action="save">
            <span class="browse-palette-key">Ctrl+S</span>
            <span class="browse-palette-desc">Save session - current page state</span>
          </div>
          <div class="browse-palette-item" data-action="sessions">
            <span class="browse-palette-key">L</span>
            <span class="browse-palette-desc">Load session - restore saved state</span>
          </div>
          <div class="browse-palette-divider"></div>
          <div class="browse-palette-item" data-action="help">
            <span class="browse-palette-key">?</span>
            <span class="browse-palette-desc">Show all keyboard shortcuts</span>
          </div>
        </div>
      </div>
    </div>
  `;

  state.overlay.appendChild(palette);

  const input = palette.querySelector('.browse-palette-input');
  input.focus();
  input.addEventListener('keydown', handlePaletteKeydown);

  palette.querySelectorAll('.browse-palette-item').forEach(item => {
    item.addEventListener('click', () => {
      executeCommand(item.dataset.action);
    });
  });
}

function closeCommandPalette() {
  const palette = state.overlay?.querySelector('.browse-command-palette');
  if (palette) palette.remove();
  state.mode = MODES.NORMAL;
}

function handlePaletteKeydown(e) {
  if (e.key === 'Escape') {
    closeCommandPalette();
    return;
  }

  if (e.key === 'Enter') {
    const selected = document.querySelector('.browse-palette-item.selected');
    if (selected) {
      executeCommand(selected.dataset.action);
    }
    return;
  }

  // Navigate results
  const items = Array.from(document.querySelectorAll('.browse-palette-item'));
  const selected = document.querySelector('.browse-palette-item.selected');
  const selectedIndex = items.indexOf(selected);

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    items.forEach(item => item.classList.remove('selected'));

    const nextIndex = e.key === 'ArrowDown'
      ? (selectedIndex + 1) % items.length
      : (selectedIndex - 1 + items.length) % items.length;

    items[nextIndex].classList.add('selected');
    items[nextIndex].scrollIntoView({ block: 'nearest' });
  }
}

function executeCommand(action) {
  closeCommandPalette();

  switch (action) {
    case 'reload':
      forceReload();
      break;
    case 'follow':
      enterFollowMode();
      break;
    case 'record':
      toggleMacroRecording();
      break;
    case 'save':
      promptSaveSession();
      break;
    case 'sessions':
      showSessions();
      break;
    case 'help':
      showHelp();
      break;
  }
}

// Macro Recording
function toggleMacroRecording() {
  state.macroRecording = !state.macroRecording;

  if (state.macroRecording) {
    state.currentMacro = [];
    updateHUD('🔴 Recording... Perform actions. Press Ctrl+Shift+R to stop.');
  } else {
    stopMacroRecording(true);
  }
}

function stopMacroRecording(save) {
  if (!state.macroRecording) return;

  state.macroRecording = false;

  if (save && state.currentMacro.length > 0) {
    const name = prompt('Name this macro:', `Macro ${state.currentMacro.length} actions`);
    if (name) {
      chrome.storage.local.get('browseMacros', (result) => {
        const macros = result.browseMacros || {};
        macros[name] = state.currentMacro;
        chrome.storage.local.set({ browseMacros: macros });
        updateHUD(`✓ Saved "${name}" with ${state.currentMacro.length} actions`);
      });
    }
  } else {
    updateHUD('Recording cancelled');
  }

  state.currentMacro = [];
}

// Sessions
function promptSaveSession() {
  const name = prompt('Session name:', `${new URL(window.location.href).hostname} - ${new Date().toLocaleString()}`);
  if (name) {
    saveSession(name);
  }
}

function saveSession(name) {
  const session = {
    name,
    url: window.location.href,
    title: document.title,
    annotations: state.annotations,
    timestamp: Date.now()
  };

  state.sessions.set(name, session);

  chrome.storage.local.get('browseSessions', (result) => {
    const sessions = result.browseSessions || {};
    sessions[name] = session;
    chrome.storage.local.set({ browseSessions: JSON.stringify(sessions) });
  });

  updateHUD(`✓ Saved session "${name}"`);
}

function loadSessions() {
  chrome.storage.local.get('browseSessions', (result) => {
    if (result.browseSessions) {
      try {
        const sessions = JSON.parse(result.browseSessions);
        Object.entries(sessions).forEach(([name, data]) => {
          state.sessions.set(name, data);
        });
      } catch (e) {
        console.error('Failed to load sessions:', e);
      }
    }
  });
}

function loadSession(name) {
  const session = state.sessions.get(name);
  if (!session) return;

  if (confirm(`Restore session "${name}" from ${new Date(session.timestamp).toLocaleString()}?`)) {
    // Navigate to URL if different
    if (window.location.href !== session.url) {
      window.location.href = session.url;
      return;
    }

    // For container-based navigation, we need to re-analyze
    // Session restore will just navigate to the page
    activate();
    updateHUD(`✓ Navigated to session page "${name}"`);
  }
}

function showSessions() {
  const sessionsList = Array.from(state.sessions.entries())
    .map(([name, data]) => ({
      name,
      ...data
    }))
    .sort((a, b) => b.timestamp - a.timestamp);

  if (sessionsList.length === 0) {
    updateHUD('No saved sessions. Press Ctrl+S to save current state.');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'browse-sessions-modal';
  modal.innerHTML = `
    <div class="browse-modal-overlay" onclick="this.parentElement.remove()">
      <div class="browse-modal-content" onclick="event.stopPropagation()">
        <h2>Saved Sessions</h2>
        <div class="browse-sessions-list">
          ${sessionsList.map(s => `
            <div class="browse-session-item" data-name="${escapeHtml(s.name)}">
              <div class="browse-session-name">${escapeHtml(s.name)}</div>
              <div class="browse-session-info">
                ${escapeHtml(s.title)} • ${new Date(s.timestamp).toLocaleString()}
              </div>
            </div>
          `).join('')}
        </div>
        <button class="browse-modal-close">Close</button>
      </div>
    </div>
  `;

  state.overlay.appendChild(modal);

  modal.querySelectorAll('.browse-session-item').forEach(item => {
    item.addEventListener('click', () => {
      loadSession(item.dataset.name);
      modal.remove();
    });
  });

  modal.querySelector('.browse-modal-close').addEventListener('click', () => {
    modal.remove();
  });
}

function showHelp() {
  const help = document.createElement('div');
  help.className = 'browse-help-modal';
  help.innerHTML = `
    <div class="browse-modal-overlay" onclick="this.parentElement.remove()">
      <div class="browse-modal-content" onclick="event.stopPropagation()">
        <h2>Browse - Keyboard Navigation</h2>
        <div class="browse-help-sections">
          <div class="browse-help-section">
            <h3>Basic Navigation</h3>
            <p><kbd>1-9</kbd> - Click top containers</p>
            <p><kbd>a-z</kbd> - Click remaining elements</p>
            <p><kbd>Esc</kbd> - Exit / Go back</p>
          </div>
          <div class="browse-help-section">
            <h3>Actions</h3>
            <p><kbd>Shift+R</kbd> - Force reload (ignore cache)</p>
            <p><kbd>F</kbd> - Follow mode (search by typing)</p>
            <p><kbd>Ctrl+P</kbd> - Command palette</p>
          </div>
          <div class="browse-help-section">
            <h3>Automation</h3>
            <p><kbd>Ctrl+Shift+R</kbd> - Record macro</p>
            <p><kbd>Ctrl+S</kbd> - Save session</p>
            <p><kbd>L</kbd> - Load session</p>
          </div>
        </div>
        <button class="browse-modal-close">Close</button>
      </div>
    </div>
  `;

  state.overlay.appendChild(help);

  help.querySelector('.browse-modal-close').addEventListener('click', () => {
    help.remove();
  });
}

// Utility functions
function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;

  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  return true;
}

function isInViewport(el) {
  const rect = el.getBoundingClientRect();
  return rect.top >= -100 && rect.top <= window.innerHeight + 100;
}

// Check if element is fully or mostly visible (for sizing annotations)
function getVisibilityFactor(el) {
  const rect = el.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  // Calculate how much of the element is visible
  const visibleTop = Math.max(0, rect.top);
  const visibleBottom = Math.min(viewportHeight, rect.bottom);
  const visibleLeft = Math.max(0, rect.left);
  const visibleRight = Math.min(viewportWidth, rect.right);

  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  const visibleWidth = Math.max(0, visibleRight - visibleLeft);

  const visibleArea = visibleHeight * visibleWidth;
  const totalArea = rect.height * rect.width;

  // Return visibility factor (0 to 1)
  if (totalArea === 0) return 0;
  return Math.min(1, visibleArea / totalArea);
}

// ========== Overlap Detection and Resolution System ==========

// Get bounding box of an annotation element (hint or badge)
function getAnnotationBoundingBox(annotationEl) {
  if (!annotationEl) return null;
  const rect = annotationEl.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2,
    element: annotationEl
  };
}

// Check if two bounding boxes overlap
function boxesOverlap(box1, box2, padding = 5) {
  // Add padding to create a buffer zone
  const b1 = {
    left: box1.left - padding,
    top: box1.top - padding,
    right: box1.right + padding,
    bottom: box1.bottom + padding
  };
  const b2 = {
    left: box2.left - padding,
    top: box2.top - padding,
    right: box2.right + padding,
    bottom: box2.bottom + padding
  };

  return !(b1.right < b2.left || b1.left > b2.right || b1.bottom < b2.top || b1.top > b2.bottom);
}

// Calculate the distance between two box centers
function boxDistance(box1, box2) {
  const dx = box1.centerX - box2.centerX;
  const dy = box1.centerY - box2.centerY;
  return Math.sqrt(dx * dx + dy * dy);
}

// Apply force-directed algorithm to resolve overlaps
function resolveAnnotationOverlaps(annotationBoxes, maxIterations = 10) {
  if (annotationBoxes.length < 2) return annotationBoxes;

  const padding = 5;
  const repulsionStrength = 15;
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight
  };

  // Force-directed layout iterations
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let hasOverlap = false;

    // Check each pair of annotations
    for (let i = 0; i < annotationBoxes.length; i++) {
      for (let j = i + 1; j < annotationBoxes.length; j++) {
        const box1 = annotationBoxes[i];
        const box2 = annotationBoxes[j];

        if (boxesOverlap(box1, box2, padding)) {
          hasOverlap = true;

          // Calculate repulsion direction
          const dx = box1.centerX - box2.centerX;
          const dy = box1.centerY - box2.centerY;
          const distance = Math.sqrt(dx * dx + dy * dy) || 1; // Avoid division by zero

          // Normalize direction
          const dirX = dx / distance;
          const dirY = dy / distance;

          // Calculate overlap amount
          const overlapX = (box1.width + box2.width) / 2 + padding - Math.abs(box1.centerX - box2.centerX);
          const overlapY = (box1.height + box2.height) / 2 + padding - Math.abs(box1.centerY - box2.centerY);

          // Apply repulsive force proportional to overlap
          const force = Math.min(overlapX, overlapY) * repulsionStrength * 0.1;

          // Move boxes apart (apply to element positions)
          applyPositionDelta(box1.element, dirX * force, dirY * force);
          applyPositionDelta(box2.element, -dirX * force, -dirY * force);

          // Update bounding boxes for next iteration
          const newBox1 = getAnnotationBoundingBox(box1.element);
          const newBox2 = getAnnotationBoundingBox(box2.element);
          if (newBox1) Object.assign(box1, newBox1);
          if (newBox2) Object.assign(box2, newBox2);
        }
      }
    }

    // No overlaps found, we're done
    if (!hasOverlap) break;
  }

  return annotationBoxes;
}

// Apply position delta to an annotation element
function applyPositionDelta(element, deltaX, deltaY) {
  if (!element) return;

  const currentLeft = parseFloat(element.style.left) || 0;
  const currentTop = parseFloat(element.style.top) || 0;

  // Calculate new position
  const newLeft = currentLeft + deltaX;
  const newTop = currentTop + deltaY;

  // Get element dimensions for clamping
  const rect = element.getBoundingClientRect();
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight
  };
  const padding = 8;

  // Clamp to viewport boundaries
  const clampedLeft = Math.max(padding, Math.min(newLeft, viewport.width - rect.width - padding));
  const clampedTop = Math.max(padding, Math.min(newTop, viewport.height - rect.height - padding));

  // Apply new position with transition
  element.style.transition = 'left 0.2s ease-out, top 0.2s ease-out';
  element.style.left = clampedLeft + 'px';
  element.style.top = clampedTop + 'px';
}

// Collect all visible annotation bounding boxes from the overlay
function collectAnnotationBoxes() {
  const boxes = [];

  if (!state.overlay) return boxes;

  // Collect container badges
  const containerBadges = state.overlay.querySelectorAll('.browse-container-badge');
  containerBadges.forEach(badge => {
    const box = getAnnotationBoundingBox(badge);
    if (box) boxes.push(box);
  });

  // Collect element hints
  const hints = state.overlay.querySelectorAll('.browse-hint');
  hints.forEach(hint => {
    const box = getAnnotationBoundingBox(hint);
    if (box) boxes.push(box);
  });

  return boxes;
}

// Main function to resolve all annotation overlaps
function resolveAllAnnotationOverlaps() {
  const boxes = collectAnnotationBoxes();
  if (boxes.length < 2) return;

  console.log('[Browse] Resolving overlaps for', boxes.length, 'annotations');
  resolveAnnotationOverlaps(boxes);

  // Remove transitions after positioning is complete
  setTimeout(() => {
    boxes.forEach(box => {
      if (box.element) {
        box.element.style.transition = '';
      }
    });
  }, 250);
}

function getElementText(el) {
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    return el.placeholder || el.name || el.value || '';
  }
  return el.textContent?.trim().substring(0, 100) || el.getAttribute('aria-label') || '';
}

function generateSelector(el) {
  if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
    return `#${el.id}`;
  }

  const path = [];
  let current = el;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    if (current.id && /^[a-zA-Z][\w-]*$/.test(current.id)) {
      selector = `#${current.id}`;
      path.unshift(selector);
      break;
    }

    if (current.className && typeof current.className === 'string') {
      const classes = current.className.split(' ')
        .filter(c => c && !c.match(/^(active|hover|focus|disabled)/i))
        .slice(0, 2);

      if (classes.length > 0) {
        selector = `${selector}.${classes.join('.')}`;
      }
    }

    const siblings = Array.from(current.parentElement?.children || [])
      .filter(e => e.tagName === current.tagName);

    if (siblings.length > 1) {
      const index = siblings.indexOf(current) + 1;
      selector += `:nth-child(${index})`;
    }

    path.unshift(selector);
    current = current.parentElement;

    if (path.length > 4) break;
  }

  return path.join(' > ');
}

function findAnnotationForElement(element) {
  return state.annotations.find(a => {
    const el = queryElementSafe(a.selector);
    return el && (el === element || element.contains(el));
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function observeChanges() {
  let lastUrl = location.href;

  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (state.active && state.enabled) {
        deactivate();
        setTimeout(() => {
          if (state.enabled && state.apiKey) activate();
        }, 500);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
