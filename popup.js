// State
let currentApiKey = '';
let currentProvider = 'openai';
let currentModel = 'gpt-5.2';
let extensionEnabled = false;

// Provider and model configurations
const PROVIDER_CONFIGS = {
  openai: {
    name: 'OpenAI',
    models: [
      { id: 'gpt-5.2', name: 'GPT-5.2 (Latest - Most Powerful)' },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini (Fast & Cost Efficient)' },
      { id: 'gpt-5.1', name: 'GPT-5.1 (Previous Flagship)' },
      { id: 'o3', name: 'o3 (Advanced Reasoning)' },
      { id: 'o3-mini', name: 'o3 Mini (Fast Reasoning)' },
      { id: 'o4-mini', name: 'o4 Mini (Lightweight Reasoning)' },
      { id: 'gpt-4.1', name: 'GPT-4.1 (Developer Series)' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini (Affordable)' }
    ],
    defaultModel: 'gpt-5.2'
  },
  groq: {
    name: 'Groq',
    models: [
      { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B (1000 T/s - Fastest!)' },
      { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B (750 T/s)' },
      { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick 17B (600 T/s)' },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant (560 T/s)' },
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B (500 T/s)' },
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile (280 T/s)' }
    ],
    defaultModel: 'openai/gpt-oss-20b'
  }
};

// DOM Elements
const providerSelect = document.getElementById('providerSelect');
const modelSelect = document.getElementById('modelSelect');
const apiKeyInput = document.getElementById('apiKeyInput');
const toggleVisibility = document.getElementById('toggleVisibility');
const extensionToggle = document.getElementById('extensionToggle');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const saveIndicator = document.getElementById('saveIndicator');

// Populate model dropdown based on provider
function populateModels(provider) {
  const config = PROVIDER_CONFIGS[provider];
  modelSelect.innerHTML = '';
  config.models.forEach(model => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    modelSelect.appendChild(option);
  });
}

// Initialize
function init() {
  // Load saved settings
  chrome.storage.local.get(['apiKey', 'provider', 'model', 'extensionEnabled'], (result) => {
    currentApiKey = result.apiKey || '';
    currentProvider = result.provider || 'openai';
    currentModel = result.model || 'gpt-5.2';
    extensionEnabled = result.extensionEnabled ?? false;

    // Update UI
    providerSelect.value = currentProvider;
    populateModels(currentProvider);
    modelSelect.value = currentModel;

    if (currentApiKey) {
      apiKeyInput.value = currentApiKey;
      statusDot.classList.add('active');
      statusText.textContent = 'API key configured';
    }

    extensionToggle.checked = extensionEnabled;
  });
}

// Save API key with debounce
let saveTimeout;
function saveApiKey() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const newValue = apiKeyInput.value.trim();
    if (newValue !== currentApiKey) {
      currentApiKey = newValue;
      chrome.storage.local.set({ apiKey: currentApiKey }, () => {
        showSaveIndicator();
        updateStatus();
        notifyContentScript();
      });
    }
  }, 500);
}

// Save provider with debounce
function saveProvider() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const newProvider = providerSelect.value;
    const newModel = PROVIDER_CONFIGS[newProvider].defaultModel;

    if (newProvider !== currentProvider) {
      currentProvider = newProvider;
      currentModel = newModel;
      populateModels(currentProvider);
      modelSelect.value = currentModel;

      chrome.storage.local.set({ provider: currentProvider, model: currentModel }, () => {
        showSaveIndicator();
        notifyContentScript();
      });
    }
  }, 300);
}

// Save model with debounce
function saveModel() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const newModel = modelSelect.value;
    if (newModel !== currentModel) {
      currentModel = newModel;
      chrome.storage.local.set({ model: currentModel }, () => {
        showSaveIndicator();
        notifyContentScript();
      });
    }
  }, 300);
}

// Toggle extension state
function toggleExtension(enabled) {
  extensionEnabled = enabled;
  chrome.storage.local.set({ extensionEnabled }, () => {
    showSaveIndicator();
    notifyContentScript();
  });
}

// Update status display
function updateStatus() {
  if (currentApiKey) {
    statusDot.classList.add('active');
    statusText.textContent = 'API key configured';
  } else {
    statusDot.classList.remove('active');
    statusText.textContent = 'Not configured';
  }
}

// Show save indicator
function showSaveIndicator() {
  saveIndicator.classList.add('show');
  setTimeout(() => {
    saveIndicator.classList.remove('show');
  }, 1500);
}

// Notify content script of changes
function notifyContentScript() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'settingsUpdated',
        apiKey: currentApiKey,
        extensionEnabled: extensionEnabled
      }).catch(() => {
        // Content script might not be loaded yet, that's okay
      });
    }
  });
}

// Toggle API key visibility
toggleVisibility.addEventListener('click', () => {
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
    toggleVisibility.textContent = '';
  } else {
    apiKeyInput.type = 'password';
    toggleVisibility.textContent = '';
  }
});

// Event listeners
providerSelect.addEventListener('change', saveProvider);
modelSelect.addEventListener('change', saveModel);
apiKeyInput.addEventListener('input', saveApiKey);
extensionToggle.addEventListener('change', (e) => toggleExtension(e.target.checked));

// Initialize on load
init();
