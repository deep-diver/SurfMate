// State management
let extensionEnabled = false;
let apiKey = '';
let provider = 'openai';
let model = 'gpt-5.2';

// Cache for analyzed pages
const pageCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Keep service worker alive
let keepAliveInterval;

function keepServiceWorkerAlive() {
  // Periodically ping the extension to keep it alive
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
      // Just pinging to keep alive
    });
  }, 20000); // Every 20 seconds
}

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('Browse extension installed');
  keepServiceWorkerAlive();
  // Set default state
  chrome.storage.local.get(['extensionEnabled', 'apiKey', 'provider', 'model'], (result) => {
    extensionEnabled = result.extensionEnabled ?? false;
    apiKey = result.apiKey || '';
    provider = result.provider || 'openai';
    model = result.model || 'gpt-5.2';
    console.log('[Browse] Initialized with provider:', provider, 'model:', model);
  });
});

// Also keep alive on startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Browse extension started');
  keepServiceWorkerAlive();
});

// Keep alive when extension is first loaded
keepServiceWorkerAlive();

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.extensionEnabled) {
      extensionEnabled = changes.extensionEnabled.newValue;
    }
    if (changes.apiKey) {
      apiKey = changes.apiKey.newValue;
    }
    if (changes.provider) {
      provider = changes.provider.newValue;
      console.log('[Browse] Provider changed to:', provider);
    }
    if (changes.model) {
      model = changes.model.newValue;
      console.log('[Browse] Model changed to:', model);
    }
  }
});

// Listen for keyboard shortcut command
chrome.commands.onCommand.addListener((command) => {
  console.log('[Browse] Command received:', command);
  if (command === 'toggle-annotations') {
    console.log('[Browse] Toggling annotations...');
    toggleExtension();
  }
});

// Toggle extension on/off
function toggleExtension() {
  extensionEnabled = !extensionEnabled;
  console.log('[Browse] Extension enabled:', extensionEnabled);
  chrome.storage.local.set({ extensionEnabled });

  // Notify all tabs about the state change
  chrome.tabs.query({}, (tabs) => {
    console.log('[Browse] Sending toggle message to', tabs.length, 'tabs');
    tabs.forEach(tab => {
      if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'toggleBrowse',
          enabled: extensionEnabled
        }).catch((error) => {
          console.log('[Browse] Failed to send message to tab', tab.id, error);
        });
      }
    });
  });
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ping handler to keep service worker alive
  if (message.type === 'ping') {
    sendResponse({ status: 'alive' });
    return true;
  }

  if (message.type === 'analyzePage') {
    handleAnalyzePage(message)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep message channel open for async response
  }

  if (message.type === 'analyzeContainer') {
    handleAnalyzeContainer(message)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep message channel open for async response
  }

  if (message.type === 'checkApiKey') {
    sendResponse({ hasApiKey: !!apiKey });
    return true;
  }

  if (message.type === 'clearCache') {
    if (message.key) {
      // Clear specific cache entry
      pageCache.delete(message.key);
    } else {
      // Clear all cache
      pageCache.clear();
    }
    sendResponse({ success: true });
    return true;
  }
});

// Analyze page using AI API with caching
async function handleAnalyzePage(message) {
  if (!apiKey) {
    return { error: 'API key not configured' };
  }

  const { domSnapshot, url, title } = message;

  // Check cache first (include provider+model in cache key)
  const cacheKey = `${url}|${provider}|${model}`;
  const cached = pageCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('[Browse] Cache hit for:', url);
    return cached.data;
  }

  console.log('[Browse] Cache miss, analyzing with', provider, 'using', model, '...');

  // Determine API endpoint and parameters based on provider
  const apiEndpoint = provider === 'groq'
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';

  // Build request body
  const requestBody = {
    model: model,
    messages: [
      {
        role: 'system',
        content: `You are a web page navigation assistant. Analyze the DOM snapshot and identify:

1. CONTAINERS (semantic sections with multiple interactive elements)
2. For EACH container, identify the TOP 5-8 most important elements inside it
3. STANDALONE elements (important elements not in any container)

BE VERY SELECTIVE - Quality over quantity:
- Maximum 20 containers total
- Maximum 3-5 standalone elements
- Maximum 8 elements per container
- Skip: decorative elements, footers, social links, cookie notices

CRITICAL: Keep labels EXTREMELY SHORT and CONCISE:
- Maximum 15-18 characters per label
- Use 2-3 words maximum
- Drop articles (the, a, an)
- Use abbreviations when appropriate (e.g., "Search" not "Search box", "Nav" not "Navigation")
- Examples: "Search", "Cart", "Login", "Menu", "Home", "Settings"

CRITICAL - SELECTOR HANDLING:
- For ELEMENTS inside containers and standalone elements: use the EXACT "selector" from the DOM snapshot
- For CONTAINER selectors: Use elements where "isContainer": true when available
  - Elements with "isContainer": true are actual container divs/navs/sections
  - Check if any isContainer element covers the region you want to make a container
  - If no isContainer element exists for a region, that's OK - just skip creating a container for that region
- NEVER use button/link/input selectors as container selectors - only use div/nav/section/header/main/footer elements
- DO NOT generate completely new selectors - only use selectors that exist in the snapshot

Return a JSON object with "containers" (each with selector, label, type, elements) and "standalone" arrays.`
      },
      {
        role: 'user',
        content: `Page URL: ${url}\nPage Title: ${title}\n\nDOM Snapshot:\n${JSON.stringify(domSnapshot, null, 2)}\n\nAnalyze this page and return containers with their elements, plus standalone elements. Use exact selectors from the snapshot for individual elements. Respond with JSON only.`
      }
    ],
    // Use max_tokens for Groq, max_completion_tokens for OpenAI
    ...(provider === 'groq' ? { max_tokens: 4000 } : { max_completion_tokens: 4000 }),
    temperature: 0.1
  };

  // Add response_format for structured output
  if (provider === 'groq') {
    requestBody.response_format = { type: 'json_object' };
  } else {
    requestBody.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'navigation_structure',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            containers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  selector: { type: 'string' },
                  label: { type: 'string' },
                  type: {
                    type: 'string',
                    enum: ['navigation', 'sidebar', 'form', 'grid', 'list', 'menu', 'card', 'section', 'other']
                  },
                  elements: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        selector: { type: 'string' },
                        label: { type: 'string' },
                        type: {
                          type: 'string',
                          enum: ['button', 'link', 'input', 'textarea', 'select']
                        }
                      },
                      required: ['selector', 'label', 'type'],
                      additionalProperties: false
                    },
                    maxItems: 8
                  }
                },
                required: ['selector', 'label', 'type', 'elements'],
                additionalProperties: false
              },
              maxItems: 20
            },
            standalone: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  selector: { type: 'string' },
                  label: { type: 'string' },
                  type: {
                    type: 'string',
                    enum: ['button', 'link', 'input', 'textarea', 'select']
                  }
                },
                required: ['selector', 'label', 'type'],
                additionalProperties: false
              },
              maxItems: 5
            }
          },
          required: ['containers', 'standalone'],
          additionalProperties: false
        }
      }
    };
  }

  console.log('[Browse] Sending request to', apiEndpoint);
  console.log('[Browse] Request body:', JSON.stringify(requestBody, null, 2));

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    console.log('[Browse] Response status:', response.status, response.statusText);

    if (!response.ok) {
      const error = await response.json();
      console.error('[Browse] API error response:', error);
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    console.log('[Browse] API response data:', data);

    const content = data.choices?.[0]?.message?.content;

    console.log('[Browse] Raw API response length:', content?.length);

    // Check if response is empty
    if (!content || content.trim().length === 0) {
      console.error('[Browse] Empty API response');
      console.error('[Browse] Full API response:', JSON.stringify(data, null, 2));
      throw new Error('Empty response from API');
    }

    // Parse JSON response
    let result;
    let contentToParse = content;

    // For Groq, try to extract JSON if wrapped in markdown or has extra text
    if (provider === 'groq') {
      // Try to find JSON object in the response
      const jsonMatch = content.match(/\{[\s\S]*"containers"[\s\S]*"standalone"[\s\S]*\}/);
      if (jsonMatch) {
        contentToParse = jsonMatch[0];
        console.log('[Browse] Extracted JSON from Groq response');
      }
    }

    try {
      const parsed = JSON.parse(contentToParse);
      console.log('[Browse] Parsed response:', parsed);
      result = {
        containers: parsed.containers || [],
        standalone: parsed.standalone || []
      };
    } catch (e) {
      console.error('[Browse] Parse error:', e);
      console.error('[Browse] Content that failed to parse:', contentToParse);
      console.error('[Browse] Raw content:', content);
      throw new Error('Failed to parse LLM response: ' + e.message);
    }

    // Cache the result
    pageCache.set(cacheKey, {
      timestamp: Date.now(),
      data: result
    });

    console.log('[Browse] Result cached for:', url);

    return result;

  } catch (error) {
    console.error('[Browse] API error:', error);
    return { error: error.message };
  }
}

// Analyze a single container using AI API
async function handleAnalyzeContainer(message) {
  if (!apiKey) {
    return { error: 'API key not configured' };
  }

  const { domSnapshot, containerLabel, containerType } = message;
  const url = domSnapshot.url;
  const title = domSnapshot.title;

  // Check cache first (include container label + provider+model in cache key)
  const cacheKey = `${url}|container|${containerLabel}|${provider}|${model}`;
  const cached = pageCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('[Browse] Cache hit for container:', containerLabel);
    return cached.data;
  }

  console.log('[Browse] Cache miss, analyzing container:', containerLabel, 'with', provider, 'using', model, '...');

  // Determine API endpoint and parameters based on provider
  const apiEndpoint = provider === 'groq'
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';

  // Build request body for container analysis
  const requestBody = {
    model: model,
    messages: [
      {
        role: 'system',
        content: `You are a web page navigation assistant. Analyze the DOM snapshot of a container section.

IMPORTANT: Find AS MANY interactive elements as possible (up to 20).

Include EVERYTHING that looks interactive:
- All buttons (primary, secondary, icon buttons)
- All links (navigation, actions, external links)
- All form inputs (text, email, password, checkbox, radio, select, textarea)
- All clickable elements with onclick handlers
- All elements with tabindex

DO NOT skip elements unless they are:
- Purely decorative (icons without actions)
- Duplicate/repeated items (like "read more" links appearing 10+ times)
- Social media sharing links

CRITICAL: Keep labels EXTREMELY SHORT and CONCISE:
- Maximum 12-15 characters per label
- Use 1-2 words maximum
- Drop articles (the, a, an)
- Use abbreviations when appropriate
- Examples: "Buy", "Edit", "Save", "Add", "Delete", "View", "Open"

CRITICAL - SELECTOR HANDLING:
- Use the EXACT "selector" from the DOM snapshot for each element
- DO NOT generate your own CSS selectors or modify existing ones
- Examples:
  * Snapshot has: "button.search" → Use: "button.search"
  * Snapshot has: "#submit-btn" → Use: "#submit-btn"

Return a JSON object with an "elements" array (up to 20 items) containing: selector, label, and type (button/link/input/textarea/select).`
      },
      {
        role: 'user',
        content: `Container: ${containerLabel} (type: ${containerType})
Page URL: ${url}
Page Title: ${title}

DOM Snapshot of this container:
${JSON.stringify(domSnapshot, null, 2)}

Analyze this container and return the most important interactive elements. Use exact selectors from the snapshot. Respond with JSON only.`
      }
    ],
    ...(provider === 'groq' ? { max_tokens: 2000 } : { max_completion_tokens: 2000 }),
    temperature: 0.1
  };

  // Add response_format for structured output
  if (provider === 'groq') {
    requestBody.response_format = { type: 'json_object' };
  } else {
    requestBody.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'container_elements',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            elements: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  selector: { type: 'string' },
                  label: { type: 'string' },
                  type: {
                    type: 'string',
                    enum: ['button', 'link', 'input', 'textarea', 'select']
                  }
                },
                required: ['selector', 'label', 'type'],
                additionalProperties: false
              },
              maxItems: 20
            }
          },
          required: ['elements'],
          additionalProperties: false
        }
      }
    };
  }

  console.log('[Browse] Sending container analysis request to', apiEndpoint);

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    console.log('[Browse] Response status:', response.status, response.statusText);

    if (!response.ok) {
      const error = await response.json();
      console.error('[Browse] API error response:', error);
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    console.log('[Browse] Raw API response length:', content?.length);

    // Check if response is empty
    if (!content || content.trim().length === 0) {
      console.error('[Browse] Empty API response');
      console.error('[Browse] Full API response:', JSON.stringify(data, null, 2));
      throw new Error('Empty response from API');
    }

    // Parse JSON response
    let result;
    let contentToParse = content;

    // For Groq, try to extract JSON if wrapped in markdown
    if (provider === 'groq') {
      const jsonMatch = content.match(/\{[\s\S]*"elements"[\s\S]*\}/);
      if (jsonMatch) {
        contentToParse = jsonMatch[0];
        console.log('[Browse] Extracted JSON from Groq response');
      }
    }

    try {
      const parsed = JSON.parse(contentToParse);
      console.log('[Browse] Parsed container response:', parsed);
      result = {
        elements: parsed.elements || []
      };
    } catch (e) {
      console.error('[Browse] Parse error:', e);
      console.error('[Browse] Content that failed to parse:', contentToParse);
      console.error('[Browse] Raw content:', content);
      throw new Error('Failed to parse LLM response: ' + e.message);
    }

    // Cache the result
    pageCache.set(cacheKey, {
      timestamp: Date.now(),
      data: result
    });

    console.log('[Browse] Container result cached for:', containerLabel);

    return result;

  } catch (error) {
    console.error('[Browse] Container API error:', error);
    return { error: error.message };
  }
}
