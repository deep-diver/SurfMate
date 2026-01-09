// State management
let extensionEnabled = false;
let apiKey = '';
let provider = 'openai';
let model = 'gpt-5.2';
let language = 'en';

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
  chrome.storage.local.get(['extensionEnabled', 'apiKey', 'provider', 'model', 'language'], (result) => {
    extensionEnabled = result.extensionEnabled ?? false;
    apiKey = result.apiKey || '';
    provider = result.provider || 'openai';
    model = result.model || 'gpt-5.2';
    language = result.language || 'en';
    console.log('[Browse] Initialized with provider:', provider, 'model:', model, 'language:', language);
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
    if (changes.language) {
      language = changes.language.newValue;
      console.log('[Browse] Language changed to:', language);
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
    // Use max_tokens for Groq, max_completion_tokens for OpenAI
    ...(provider === 'groq' ? { max_tokens: 4000 } : { max_completion_tokens: 4000 }),
    temperature: 0.1
  };

  // Add response_format for structured output
  if (provider === 'groq') {
    requestBody.response_format = { type: 'json_object' };
  } else {
    // Use json_object mode instead of strict json_schema for better compatibility
    requestBody.response_format = { type: 'json_object' };
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
    ...(provider === 'groq' ? { max_tokens: 2000 } : { max_completion_tokens: 2000 }),
    temperature: 0.1
  };

  // Add response_format for structured output
  if (provider === 'groq') {
    requestBody.response_format = { type: 'json_object' };
  } else {
    // Use json_object mode instead of strict json_schema for better compatibility
    requestBody.response_format = { type: 'json_object' };
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
