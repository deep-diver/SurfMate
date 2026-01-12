// State management
let extensionEnabled = false;
let openaiApiKey = '';
let geminiApiKey = '';
let provider = 'openai';
let model = 'gpt-5.2';
let language = 'en';

// Get current API key based on provider
function getApiKey() {
  return provider === 'gemini' ? geminiApiKey : openaiApiKey;
}

// Cache for analyzed pages (no TTL - cache persists until manually cleared)
const pageCache = new Map();

// Request queue to prevent rate limiting - sequentialize API calls
let apiQueue = Promise.resolve();
const REQUEST_DELAY = 500; // 500ms between requests for Gemini

async function queueRequest(requestFn) {
  // Add this request to the queue
  const previousQueue = apiQueue;
  apiQueue = previousQueue.then(async () => {
    const result = await requestFn();
    // Add delay between requests for Gemini
    if (provider === 'gemini') {
      await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
    }
    return result;
  }, (err) => {
    // Even if there's an error, add delay before next request
    return new Promise(resolve => setTimeout(resolve, REQUEST_DELAY)).then(() => Promise.reject(err));
  });
  return apiQueue;
}

// Retry fetch with exponential backoff for rate limiting (429 errors)
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, options);

    // If not a rate limit error, return immediately
    if (response.status !== 429) {
      return response;
    }

    // If this is the last attempt, throw the error
    if (attempt === maxRetries - 1) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Rate limit exceeded');
    }

    // Calculate exponential backoff delay: 2^attempt seconds (1s, 2s, 4s, etc.)
    const delayMs = Math.pow(2, attempt) * 1000;
    console.log(`[SurfMate] Rate limited (429), retrying in ${delayMs}ms... (attempt ${attempt + 1}/${maxRetries})`);

    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

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
  chrome.storage.local.get(['extensionEnabled', 'openaiApiKey', 'geminiApiKey', 'provider', 'model', 'language'], (result) => {
    extensionEnabled = result.extensionEnabled ?? false;
    openaiApiKey = result.openaiApiKey || '';
    geminiApiKey = result.geminiApiKey || '';
    provider = result.provider || 'openai';
    model = result.model || 'gpt-5.2';
    language = result.language || 'en';
    console.log('[SurfMate] Initialized with provider:', provider, 'model:', model, 'language:', language);
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
    if (changes.openaiApiKey) {
      openaiApiKey = changes.openaiApiKey.newValue;
      console.log('[SurfMate] OpenAI API key updated');
    }
    if (changes.geminiApiKey) {
      geminiApiKey = changes.geminiApiKey.newValue;
      console.log('[SurfMate] Gemini API key updated');
    }
    if (changes.provider) {
      provider = changes.provider.newValue;
      console.log('[SurfMate] Provider changed to:', provider);
    }
    if (changes.model) {
      model = changes.model.newValue;
      console.log('[SurfMate] Model changed to:', model);
    }
    if (changes.language) {
      language = changes.language.newValue;
      console.log('[SurfMate] Language changed to:', language);
    }
  }
});

// Listen for keyboard shortcut command
chrome.commands.onCommand.addListener((command) => {
  console.log('[SurfMate] Command received:', command);
  if (command === 'toggle-annotations') {
    console.log('[SurfMate] Toggling annotations...');
    toggleExtension();
  }
});

// Toggle extension on/off
function toggleExtension() {
  extensionEnabled = !extensionEnabled;
  console.log('[SurfMate] Extension enabled:', extensionEnabled);
  chrome.storage.local.set({ extensionEnabled });

  // Notify all tabs about the state change
  chrome.tabs.query({}, (tabs) => {
    console.log('[SurfMate] Sending toggle message to', tabs.length, 'tabs');
    tabs.forEach(tab => {
      if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'toggleBrowse',
          enabled: extensionEnabled
        }).catch((error) => {
          console.log('[SurfMate] Failed to send message to tab', tab.id, error);
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
    queueRequest(() => handleAnalyzePage(message))
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep message channel open for async response
  }

  if (message.type === 'analyzeContainer') {
    queueRequest(() => handleAnalyzeContainer(message))
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep message channel open for async response
  }

  if (message.type === 'findAdditionalContainers') {
    queueRequest(() => handleFindAdditionalContainers(message))
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
  if (!getApiKey()) {
    return { error: 'API key not configured' };
  }

  const { domSnapshot, url, title } = message;

  // Check cache first (include provider+model in cache key)
  const cacheKey = `${url}|${provider}|${model}`;
  const cached = pageCache.get(cacheKey);

  if (cached) {
    console.log('[SurfMate] Cache hit for:', url);
    return cached.data;
  }

  console.log('[SurfMate] Cache miss, analyzing with', provider, 'using', model, '...');

  // Use Gemini API handler
  if (provider === 'gemini') {
    return handleAnalyzePageGemini(message, cacheKey);
  }

  // OpenAI API (original code)
  return handleAnalyzePageOpenAI(message, cacheKey);
}

// Handle OpenAI API calls
async function handleAnalyzePageOpenAI(message, cacheKey) {
  const { domSnapshot, url, title } = message;

  const apiEndpoint = 'https://api.openai.com/v1/chat/completions';

  // Build request body
  const requestBody = {
    model: model,
    messages: [
      {
        role: 'system',
        content: `You are a web page navigation assistant. Analyze the DOM snapshot and identify:

1. CONTAINERS (semantic sections with multiple interactive elements) - Return the container selector and label ONLY
2. STANDALONE elements (important elements not in any container) - For elements that don't belong in any container

*** IMPORTANT ***
- For CONTAINERS: Only return the container selector, label, and type. DO NOT include elements inside containers.
- Elements inside containers will be detected dynamically when the user enters the container.
- This is important because container contents often change dynamically (especially in SPAs).

${domSnapshot.isGradio ? `
*** GRADIO APP DETECTED ***
This is a Gradio/ML application. Pay special attention to:
- Gradio components: inputs (textbox, dropdown, slider, checkbox, radio, file upload)
- Submit/Generate/Run buttons (highest priority!)
- Output areas: galleries, chatbots, dataframes, markdown
- Grouped components in tabs, accordions, or rows/columns

For Gradio apps:
- Group related components (e.g., all inputs in one section)
- Submit/Clear buttons are always important
- Output areas (chatbot, gallery, dataframe) are important containers
` : ''}

*** LANGUAGE ***
${language === 'ko' ? `
ALL labels and descriptions MUST be in Korean (한국어).
- Use natural Korean phrases for labels
- Examples:
  ❌ BAD: "Search", "Submit", "Login"
  ✅ GOOD: "검색", "제출", "로그인"
  ✅ GOOD: "상품 검색", "게시글 등록", "로그인하기"
- Keep labels SHORT (10-15 Korean characters) but MEANINGFUL
` : language === 'en' ? `
ALL labels and descriptions MUST be in English.
- Use natural English phrases for labels
` : ''}

*** CRITICAL - ORDER BY WORKFLOW IMPORTANCE ***
The ORDER of containers in your response determines their keyboard shortcut numbers (1-9).
Return containers in the LOGICAL ORDER a user should interact with them:
- First: Input/entry points (search box, prompt input, forms)
- Second: Primary actions (submit, generate, run, search buttons)
- Third: Results/outputs (results, gallery, output display)
- Fourth: Secondary actions (settings, filters, options)
- Last: Navigation and utility items

${domSnapshot.isGradio ? `
Gradio workflow ordering example:
1. Prompt/Model input area
2. Submit/Generate button
3. Output gallery/chatbot
4. Settings/Advanced options
` : ''}

BE VERY SELECTIVE - Quality over quantity:
- Find ALL meaningful containers on the page (no limit)
- Focus on sections with actual interactive content (buttons, links, forms)
- Maximum 5 standalone elements
- Skip: decorative elements, footers, social links, cookie notices, empty containers

*** CRITICAL - MEANINGFUL LABELS THAT ADD VALUE ***
Your labels should provide CONTEXT and ACTIONABLE GUIDANCE, NOT just repeat visible text:
- DO NOT just copy the button/input text - users can already see that!
- INSTEAD: Describe the PURPOSE, ACTION, or OUTCOME
- Use action verbs: "Enter...", "Generate...", "View...", "Adjust..."
- Combine context with function for clarity

${domSnapshot.isGradio ? `
Gradio examples:
❌ BAD: "Submit", "Prompt", "Output"
✅ GOOD: "Generate image", "Enter your prompt", "View results"

❌ BAD: "Model", "Settings", "Clear"
✅ GOOD: "Choose AI model", "Adjust parameters", "Reset form"
` : ''}

General examples:
❌ BAD: "Search", "Login", "Cart"
✅ GOOD: "Find products", "Sign in", "View 3 items"

❌ BAD: "Submit", "Save", "Cancel"
✅ GOOD: "Post comment", "Save changes", "Go back"

Keep labels SHORT (15-20 chars) but MEANINGFUL:
- "Generate image" (not "Submit")
- "Enter search terms" (not "Search box")
- "View cart (3)" (not "Cart")

CRITICAL - SELECTOR HANDLING:
- For CONTAINERS: Use elements where "isContainer": true from the DOM snapshot
  - Elements with "isContainer": true are actual container divs/navs/sections
  - Check if any isContainer element covers the region you want to make a container
  - If no isContainer element exists for a region, that's OK - just skip creating a container for that region
- For STANDALONE ELEMENTS: use the EXACT "selector" from the DOM snapshot
- NEVER use button/link/input selectors as container selectors - only use div/nav/section/header/main/footer elements
- DO NOT generate completely new selectors - only use selectors that exist in the snapshot
${domSnapshot.isGradio ? `
- For Gradio: Use the exact selector from the snapshot, including those marked "isGradioComponent"
- Gradio components often have nested structures - prefer the innermost actionable element
` : ''}

Return a JSON object with "containers" (each with selector, label, type) and "standalone" arrays.`
      },
      {
        role: 'user',
        content: `Page URL: ${url}\nPage Title: ${title}\n${domSnapshot.isGradio ? '\n*** GRADIO APP *** This is a Gradio/ML application interface.\n' : ''}\n\nDOM Snapshot:\n${JSON.stringify(domSnapshot, null, 2)}\n\nAnalyze this page and return containers in WORKFLOW ORDER with MEANINGFUL, ACTION-ORIENTED labels that add value beyond visible text. Use exact selectors from the snapshot. Respond with JSON only.`
      }
    ],
    max_completion_tokens: 4000,
    temperature: 0.1,
    response_format: { type: 'json_object' }
  };

  console.log('[SurfMate] Sending request to', apiEndpoint);

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getApiKey()}`
      },
      body: JSON.stringify(requestBody)
    });

    console.log('[SurfMate] Response status:', response.status, response.statusText);

    if (!response.ok) {
      const error = await response.json();
      console.error('[SurfMate] API error response:', error);
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    console.log('[SurfMate] API response data:', data);

    const content = data.choices?.[0]?.message?.content;

    console.log('[SurfMate] Raw API response length:', content?.length);

    // Check if response is empty
    if (!content || content.trim().length === 0) {
      console.error('[SurfMate] Empty API response');
      console.error('[SurfMate] Full API response:', JSON.stringify(data, null, 2));
      throw new Error('Empty response from API');
    }

    // Parse JSON response
    let result;
    try {
      const parsed = JSON.parse(content);
      console.log('[SurfMate] Parsed response:', parsed);
      result = {
        containers: parsed.containers || [],
        standalone: parsed.standalone || []
      };
    } catch (e) {
      console.error('[SurfMate] Parse error:', e);
      console.error('[SurfMate] Content that failed to parse:', content);
      throw new Error('Failed to parse LLM response: ' + e.message);
    }

    // Cache the result
    pageCache.set(cacheKey, {
      timestamp: Date.now(),
      data: result
    });

    console.log('[SurfMate] Result cached for:', url);

    return result;

  } catch (error) {
    console.error('[SurfMate] API error:', error);
    return { error: error.message };
  }
}

// Handle Gemini API calls
async function handleAnalyzePageGemini(message, cacheKey) {
  const { domSnapshot, url, title } = message;

  const apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${getApiKey()}`;

  // Build the system prompt
  const systemPrompt = `You are a web page navigation assistant. Analyze the DOM snapshot and identify:

1. CONTAINERS (semantic sections with multiple interactive elements) - Return the container selector and label ONLY
2. STANDALONE elements (important elements not in any container) - For elements that don't belong in any container

*** IMPORTANT ***
- For CONTAINERS: Only return the container selector, label, and type. DO NOT include elements inside containers.
- Elements inside containers will be detected dynamically when the user enters the container.

*** LANGUAGE ***
${language === 'ko' ? 'ALL labels MUST be in Korean (한국어)' : 'ALL labels MUST be in English'}

*** ORDER ***
Return in workflow order: inputs → actions → outputs → settings → navigation

*** LABELS ***
Be descriptive: "Search box" not "input", "Submit form" not "button"

Return ONLY JSON with "containers" and "standalone" arrays.`;

  // Build user prompt with DOM snapshot
  const userPrompt = `Page URL: ${url}\nPage Title: ${title}\n\nDOM Snapshot:\n${JSON.stringify(domSnapshot, null, 2)}`;

  // Gemini API request format with structured output
  const requestBody = {
    contents: [{
      parts: [
        { text: systemPrompt + '\n\n' + userPrompt }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      thinkingConfig: {
        thinkingBudget: 0  // Disable thinking mode for faster responses
      },
      responseSchema: {
        type: 'object',
        properties: {
          containers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                selector: { type: 'string', description: 'CSS selector for the container element' },
                label: { type: 'string', description: 'Human-readable label for the container' },
                type: { type: 'string', description: 'Container type: navigation, main, form, list, card, section, etc.' }
              },
              required: ['selector', 'label', 'type']
            }
          },
          standalone: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                selector: { type: 'string', description: 'CSS selector for the element' },
                label: { type: 'string', description: 'Action-oriented label for this element' },
                type: { type: 'string', description: 'Element type: button, link, input, textarea, select' }
              },
              required: ['selector', 'label', 'type']
            }
          }
        },
        required: ['containers', 'standalone']
      }
    }
  };

  console.log('[SurfMate] Sending request to Gemini API');

  try {
    const response = await fetchWithRetry(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    console.log('[SurfMate] Response status:', response.status, response.statusText);

    if (!response.ok) {
      const error = await response.json();
      console.error('[SurfMate] Gemini API error:', error);
      throw new Error(error.error?.message || 'Gemini API request failed');
    }

    const data = await response.json();
    console.log('[SurfMate] Gemini API response data:', data);

    // Check if response was truncated due to token limit
    const finishReason = data.candidates?.[0]?.finishReason;
    if (finishReason === 'MAX_TOKENS') {
      console.error('[SurfMate] Response was truncated due to maxOutputTokens limit');
      throw new Error('Response too large - try reducing page complexity or increase token limit');
    }

    // Gemini returns text in candidates[0].content.parts[0].text
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    console.log('[SurfMate] Raw API response length:', content?.length);

    if (!content || content.trim().length === 0) {
      console.error('[SurfMate] Empty Gemini API response');
      throw new Error('Empty response from Gemini API');
    }

    // Parse JSON response
    let result;
    try {
      const parsed = JSON.parse(content);
      console.log('[SurfMate] Parsed response:', parsed);
      result = {
        containers: parsed.containers || [],
        standalone: parsed.standalone || []
      };
    } catch (e) {
      console.error('[SurfMate] Parse error:', e);
      console.error('[SurfMate] Content that failed to parse:', content);
      throw new Error('Failed to parse Gemini response: ' + e.message);
    }

    // Cache the result
    const cacheKey = `${url}|${provider}|${model}`;
    pageCache.set(cacheKey, {
      timestamp: Date.now(),
      data: result
    });

    console.log('[SurfMate] Result cached for:', url);

    return result;

  } catch (error) {
    console.error('[SurfMate] Gemini API error:', error);
    return { error: error.message };
  }
}

// Analyze a single container using AI API
async function handleAnalyzeContainer(message) {
  if (!getApiKey()) {
    return { error: 'API key not configured' };
  }

  const { domSnapshot, containerLabel, containerType } = message;
  const url = domSnapshot.url;

  // Check cache first (include container label + provider+model in cache key)
  const cacheKey = `${url}|container|${containerLabel}|${provider}|${model}`;
  const cached = pageCache.get(cacheKey);

  if (cached) {
    console.log('[SurfMate] Cache hit for container:', containerLabel);
    return cached.data;
  }

  console.log('[SurfMate] Cache miss, analyzing container:', containerLabel, 'with', provider, 'using', model, '...');

  // Use Gemini API handler
  if (provider === 'gemini') {
    return handleAnalyzeContainerGemini(message, cacheKey);
  }

  // OpenAI API (original code)
  return handleAnalyzeContainerOpenAI(message, cacheKey);
}

// Handle OpenAI API calls for container analysis
async function handleAnalyzeContainerOpenAI(message, cacheKey) {
  const { domSnapshot, containerLabel, containerType } = message;
  const url = domSnapshot.url;
  const title = domSnapshot.title;

  const apiEndpoint = 'https://api.openai.com/v1/chat/completions';

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

*** LANGUAGE ***
${language === 'ko' ? `
ALL labels MUST be in Korean (한국어).
- Use natural Korean action verbs
- Examples:
  ❌ BAD: "Submit", "Search", "Save"
  ✅ GOOD: "제출", "검색", "저장"
  ✅ GOOD: "댓글 작성", "상품 검색", "변경사항 저장"
- Keep labels SHORT (8-12 Korean characters)
` : language === 'en' ? `
ALL labels MUST be in English.
- Use natural English action verbs
` : ''}

*** CRITICAL - ORDER BY WORKFLOW IMPORTANCE ***
The ORDER of elements in your response determines their keyboard shortcut letters (a-z).
Return elements in the LOGICAL ORDER a user should interact with them within this container:
- First: Inputs and form fields
- Second: Primary action buttons (submit, confirm, save)
- Third: Secondary actions (cancel, delete, edit)
- Last: Navigation and utility links

*** CRITICAL - MEANINGFUL LABELS THAT ADD VALUE ***
Your labels should provide CONTEXT and ACTIONABLE GUIDANCE, NOT just repeat visible text:
- DO NOT just copy the button/input text - users can already see that!
- INSTEAD: Describe the PURPOSE, ACTION, or OUTCOME
- Use action verbs: "Enter...", "Click to...", "View...", "Adjust..."

Examples:
❌ BAD: "Submit", "Search", "Buy"
✅ GOOD: "Post comment", "Find products", "Add to cart"

❌ BAD: "Email", "Password", "Name"
✅ GOOD: "Enter email", "Choose password", "Your full name"

❌ BAD: "Edit", "Delete", "Cancel"
✅ GOOD: "Modify item", "Remove item", "Go back"

Keep labels SHORT (12-18 chars) but MEANINGFUL:
- Focus on WHAT HAPPENS or WHAT TO DO
- Include context when helpful

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

Analyze this container and return interactive elements in WORKFLOW ORDER with MEANINGFUL, ACTION-ORIENTED labels that add value beyond visible text. Use exact selectors from the snapshot. Respond with JSON only.`
      }
    ],
    max_completion_tokens: 2000,
    temperature: 0.1,
    response_format: { type: 'json_object' }
  };

  console.log('[SurfMate] Sending container analysis request to OpenAI');

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getApiKey()}`
      },
      body: JSON.stringify(requestBody)
    });

    console.log('[SurfMate] Response status:', response.status, response.statusText);

    if (!response.ok) {
      const error = await response.json();
      console.error('[SurfMate] API error response:', error);
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    console.log('[SurfMate] Raw API response length:', content?.length);

    if (!content || content.trim().length === 0) {
      console.error('[SurfMate] Empty API response');
      console.error('[SurfMate] Full API response:', JSON.stringify(data, null, 2));
      throw new Error('Empty response from API');
    }

    const parsed = JSON.parse(content);
    console.log('[SurfMate] Parsed container response:', parsed);
    const result = {
      elements: parsed.elements || []
    };

    pageCache.set(cacheKey, {
      timestamp: Date.now(),
      data: result
    });

    console.log('[SurfMate] Container result cached for:', containerLabel);

    return result;

  } catch (error) {
    console.error('[SurfMate] Container API error:', error);
    return { error: error.message };
  }
}

// Handle Gemini API calls for container analysis
async function handleAnalyzeContainerGemini(message, cacheKey) {
  const { domSnapshot, containerLabel, containerType } = message;
  const url = domSnapshot.url;
  const title = domSnapshot.title;

  const apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${getApiKey()}`;

  const systemPrompt = `You are a web page navigation assistant. Analyze the DOM snapshot of a container section.

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

*** LANGUAGE ***
${language === 'ko' ? `
ALL labels MUST be in Korean (한국어).
- Use natural Korean action verbs
- Examples:
  ❌ BAD: "Submit", "Search", "Save"
  ✅ GOOD: "제출", "검색", "저장"
  ✅ GOOD: "댓글 작성", "상품 검색", "변경사항 저장"
- Keep labels SHORT (8-12 Korean characters)
` : language === 'en' ? `
ALL labels MUST be in English.
- Use natural English action verbs
` : ''}

*** CRITICAL - ORDER BY WORKFLOW IMPORTANCE ***
The ORDER of elements in your response determines their keyboard shortcut letters (a-z).
Return elements in the LOGICAL ORDER a user should interact with them within this container:
- First: Inputs and form fields
- Second: Primary action buttons (submit, confirm, save)
- Third: Secondary actions (cancel, delete, edit)
- Last: Navigation and utility links

*** CRITICAL - MEANINGFUL LABELS THAT ADD VALUE ***
Your labels should provide CONTEXT and ACTIONABLE GUIDANCE, NOT just repeat visible text:
- DO NOT just copy the button/input text - users can already see that!
- INSTEAD: Describe the PURPOSE, ACTION, or OUTCOME
- Use action verbs: "Enter...", "Click to...", "View...", "Adjust..."

Examples:
❌ BAD: "Submit", "Search", "Buy"
✅ GOOD: "Post comment", "Find products", "Add to cart"

❌ BAD: "Email", "Password", "Name"
✅ GOOD: "Enter email", "Choose password", "Your full name"

❌ BAD: "Edit", "Delete", "Cancel"
✅ GOOD: "Modify item", "Remove item", "Go back"

Keep labels SHORT (12-18 chars) but MEANINGFUL:
- Focus on WHAT HAPPENS or WHAT TO DO
- Include context when helpful

CRITICAL - SELECTOR HANDLING:
- Use the EXACT "selector" from the DOM snapshot for each element
- DO NOT generate your own CSS selectors or modify existing ones
- Examples:
  * Snapshot has: "button.search" → Use: "button.search"
  * Snapshot has: "#submit-btn" → Use: "#submit-btn"

Return a JSON object with an "elements" array (up to 20 items) containing: selector, label, and type (button/link/input/textarea/select).`;

  const userPrompt = `Container: ${containerLabel} (type: ${containerType})
Page URL: ${url}
Page Title: ${title}

DOM Snapshot of this container:
${JSON.stringify(domSnapshot, null, 2)}

Analyze this container and return interactive elements in WORKFLOW ORDER with MEANINGFUL, ACTION-ORIENTED labels that add value beyond visible text. Use exact selectors from the snapshot. Respond with JSON only.`;

  const requestBody = {
    contents: [{
      parts: [
        { text: systemPrompt + '\n\n' + userPrompt }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      thinkingConfig: {
        thinkingBudget: 0  // Disable thinking mode for faster responses
      },
      responseSchema: {
        type: 'object',
        properties: {
          elements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                selector: { type: 'string', description: 'Exact CSS selector from DOM snapshot' },
                label: { type: 'string', description: 'Action-oriented label describing what the element does' },
                type: {
                  type: 'string',
                  description: 'Element type',
                  enum: ['button', 'link', 'input', 'textarea', 'select']
                }
              },
              required: ['selector', 'label', 'type']
            }
          }
        },
        required: ['elements']
      }
    }
  };

  console.log('[SurfMate] Sending container analysis request to Gemini');

  try {
    const response = await fetchWithRetry(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    console.log('[SurfMate] Response status:', response.status, response.statusText);

    if (!response.ok) {
      const error = await response.json();
      console.error('[SurfMate] API error response:', error);
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();

    // Check if response was truncated due to token limit
    const finishReason = data.candidates?.[0]?.finishReason;
    if (finishReason === 'MAX_TOKENS') {
      console.error('[SurfMate] Response was truncated due to maxOutputTokens limit');
      throw new Error('Response too large - try reducing container complexity or increase token limit');
    }

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    console.log('[SurfMate] Raw API response length:', content?.length);

    if (!content || content.trim().length === 0) {
      console.error('[SurfMate] Empty API response');
      console.error('[SurfMate] Full API response:', JSON.stringify(data, null, 2));
      throw new Error('Empty response from API');
    }

    const parsed = JSON.parse(content);
    console.log('[SurfMate] Parsed container response:', parsed);
    const result = {
      elements: parsed.elements || []
    };

    pageCache.set(cacheKey, {
      timestamp: Date.now(),
      data: result
    });

    console.log('[SurfMate] Container result cached for:', containerLabel);

    return result;

  } catch (error) {
    console.error('[SurfMate] Container API error:', error);
    return { error: error.message };
  }
}


// Find additional containers (Shift+A) - excludes already found ones
async function handleFindAdditionalContainers(message) {
  if (!getApiKey()) {
    return { error: 'API key not configured' };
  }

  const { domSnapshot, excludeSelectors, containerScopes } = message;
  const url = domSnapshot.url;

  // Use Gemini API handler
  if (provider === 'gemini') {
    return handleFindAdditionalContainersGemini(message, url, containerScopes);
  }

  // OpenAI API
  return handleFindAdditionalContainersOpenAI(message, url, containerScopes);
}

// OpenAI handler for finding additional containers
async function handleFindAdditionalContainersOpenAI(message, url, containerScopes) {
  const { domSnapshot, excludeSelectors } = message;
  const title = domSnapshot.title;

  const apiEndpoint = 'https://api.openai.com/v1/chat/completions';

  // Build exclude list for prompt
  const excludeList = excludeSelectors.map((s, i) => `${i + 1}. ${s}`).join('\n');

  // Build container scope list - elements inside these should be ignored
  const scopeList = containerScopes.map((s, i) => `${i + 1}. ${s}`).join('\n');

  const requestBody = {
    model: model,
    messages: [
      {
        role: 'system',
        content: `You are a web page navigation assistant. Find ADDITIONAL containers and standalone elements that were NOT already identified.

IMPORTANT - Exclude these already found selectors:
${excludeList}

CRITICAL - IGNORE ALL ELEMENTS INSIDE THESE CONTAINERS:
${scopeList}
Any element that is a descendant (child, grandchild, etc.) of the containers above MUST be ignored. Only look for siblings or ancestors of these containers.

Find:
1. ADDITIONAL CONTAINERS - Semantic sections with multiple interactive elements (NOT in exclude list, NOT inside scope containers above)
2. ADDITIONAL STANDALONE elements - Important standalone elements (NOT in exclude list, NOT inside scope containers above)

Return JSON ONLY with this exact structure:
{
  "containers": [
    {"selector": "css_selector", "label": "human_readable_label", "type": "container_type"}
  ],
  "standalone": [
    {"selector": "css_selector", "label": "human_readable_label", "type": "element_type"}
  ]
}

Rules:
- DO NOT return any selector from the exclude list
- DO NOT return any element that is inside/nested within the scope containers
- Only return NEW/MISSING containers and elements at the same level or higher, not nested inside existing ones
- Use CSS attribute selectors like [data-testid="..."] over complex nth-child
- For dynamic classes use: [class*="partial-class-name"]
- Escape single quotes in selectors with backslash: \\\'`
      },
      {
        role: 'user',
        content: `URL: ${url}\nTitle: ${title}\n\nDOM Snapshot:\n${JSON.stringify(domSnapshot, null, 2)}`
      }
    ],
    temperature: 0.1,
    max_tokens: 4000,
    response_format: { type: "json_object" }
  };

  try {
    const response = await fetchWithRetry(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getApiKey()}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    console.log('[SurfMate] Additional containers response:', content);

    const parsed = JSON.parse(content);
    const result = {
      containers: parsed.containers || [],
      standalone: parsed.standalone || []
    };

    console.log('[SurfMate] Found additional containers:', result.containers.length, 'standalone:', result.standalone.length);

    return result;

  } catch (error) {
    console.error('[SurfMate] Additional containers API error:', error);
    return { error: error.message };
  }
}

// Gemini handler for finding additional containers
async function handleFindAdditionalContainersGemini(message, url, containerScopes) {
  const { domSnapshot, excludeSelectors } = message;
  const title = domSnapshot.title;

  const apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${getApiKey()}`;

  // Build exclude list for prompt
  const excludeList = excludeSelectors.map((s, i) => `${i + 1}. ${s}`).join('\n');

  // Build container scope list - elements inside these should be ignored
  const scopeList = containerScopes.map((s, i) => `${i + 1}. ${s}`).join('\n');

  const systemPrompt = `You are a web page navigation assistant. Find ADDITIONAL containers and standalone elements that were NOT already identified.

IMPORTANT - Exclude these already found selectors:
${excludeList}

CRITICAL - IGNORE ALL ELEMENTS INSIDE THESE CONTAINERS:
${scopeList}
Any element that is a descendant (child, grandchild, etc.) of the containers above MUST be ignored. Only look for siblings or ancestors of these containers.

Find:
1. ADDITIONAL CONTAINERS - Semantic sections with multiple interactive elements (NOT in exclude list, NOT inside scope containers above)
2. ADDITIONAL STANDALONE elements - Important standalone elements (NOT in exclude list, NOT inside scope containers above)

Return JSON with this structure:
{
  "containers": [
    {"selector": "css_selector", "label": "human_readable_label", "type": "container_type"}
  ],
  "standalone": [
    {"selector": "css_selector", "label": "human_readable_label", "type": "element_type"}
  ]
}

Rules:
- DO NOT return any selector from the exclude list
- DO NOT return any element that is inside/nested within the scope containers
- Only return NEW/MISSING containers and elements at the same level or higher, not nested inside existing ones`;

  const userPrompt = `URL: ${url}\nTitle: ${title}\n\nDOM Snapshot:\n${JSON.stringify(domSnapshot, null, 2)}`;

  const requestBody = {
    contents: [{
      parts: [{ text: systemPrompt + '\n\n' + userPrompt }]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      thinkingConfig: {
        thinkingBudget: 0
      },
      responseSchema: {
        type: "object",
        properties: {
          containers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                selector: { type: "string" },
                label: { type: "string" },
                type: { type: "string" }
              },
              required: ["selector", "label", "type"]
            }
          },
          standalone: {
            type: "array",
            items: {
              type: "object",
              properties: {
                selector: { type: "string" },
                label: { type: "string" },
                type: { type: "string" }
              },
              required: ["selector", "label", "type"]
            }
          }
        },
        required: ["containers", "standalone"]
      }
    }
  };

  try {
    const response = await fetchWithRetry(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.candidates[0].content.parts[0].text;

    console.log('[SurfMate] Additional containers response:', content);

    const parsed = JSON.parse(content);
    const result = {
      containers: parsed.containers || [],
      standalone: parsed.standalone || []
    };

    console.log('[SurfMate] Found additional containers:', result.containers.length, 'standalone:', result.standalone.length);

    return result;

  } catch (error) {
    console.error('[SurfMate] Additional containers API error:', error);
    return { error: error.message };
  }
}
