// State
let currentOpenAIKey = '';
let currentGeminiKey = '';
let currentProvider = 'openai';
let currentModel = 'gpt-5.2';
let extensionEnabled = false;
let currentLanguage = 'en';

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
  gemini: {
    name: 'Gemini (Google AI)',
    models: [
      { id: 'gemini-3-flash-preview', name: 'Gemini 3.0 Flash' }
    ],
    defaultModel: 'gemini-3-flash-preview'
  }
};

// DOM Elements
const providerSelect = document.getElementById('providerSelect');
const modelSelect = document.getElementById('modelSelect');
const languageSelect = document.getElementById('languageSelect');
const openaiApiKeyInput = document.getElementById('openaiApiKeyInput');
const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
const toggleOpenAIKeyVisibility = document.getElementById('toggleOpenAIKeyVisibility');
const toggleGeminiKeyVisibility = document.getElementById('toggleGeminiKeyVisibility');
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

// Get current API key based on provider
function getCurrentApiKey() {
  return currentProvider === 'gemini' ? currentGeminiKey : currentOpenAIKey;
}

// Initialize
function init() {
  // Load saved settings
  chrome.storage.local.get(['openaiApiKey', 'geminiApiKey', 'provider', 'model', 'extensionEnabled', 'language'], (result) => {
    currentOpenAIKey = result.openaiApiKey || '';
    currentGeminiKey = result.geminiApiKey || '';
    currentProvider = result.provider || 'openai';
    currentModel = result.model || 'gpt-5.2';
    extensionEnabled = result.extensionEnabled ?? false;
    currentLanguage = result.language || 'en';

    // Update UI
    providerSelect.value = currentProvider;
    populateModels(currentProvider);
    modelSelect.value = currentModel;
    languageSelect.value = currentLanguage;

    // Set API key inputs
    openaiApiKeyInput.value = currentOpenAIKey;
    geminiApiKeyInput.value = currentGeminiKey;

    // Update status based on current provider's API key
    updateStatus();

    extensionToggle.checked = extensionEnabled;
  });
}

// Save OpenAI API key with debounce
let saveTimeout;
function saveOpenAIKey() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const newValue = openaiApiKeyInput.value.trim();
    if (newValue !== currentOpenAIKey) {
      currentOpenAIKey = newValue;
      chrome.storage.local.set({ openaiApiKey: currentOpenAIKey }, () => {
        showSaveIndicator();
        updateStatus();
        notifyContentScript();
      });
    }
  }, 500);
}

// Save Gemini API key with debounce
function saveGeminiKey() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const newValue = geminiApiKeyInput.value.trim();
    if (newValue !== currentGeminiKey) {
      currentGeminiKey = newValue;
      chrome.storage.local.set({ geminiApiKey: currentGeminiKey }, () => {
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

      updateStatus();

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

// Save language with debounce
function saveLanguage() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const newLanguage = languageSelect.value;
    if (newLanguage !== currentLanguage) {
      currentLanguage = newLanguage;
      chrome.storage.local.set({ language: currentLanguage }, () => {
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
  const currentKey = getCurrentApiKey();
  if (currentKey) {
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
        apiKey: getCurrentApiKey(),
        provider: currentProvider,
        extensionEnabled: extensionEnabled
      }).catch(() => {
        // Content script might not be loaded yet, that's okay
      });
    }
  });
}

// Toggle OpenAI API key visibility
toggleOpenAIKeyVisibility.addEventListener('click', () => {
  if (openaiApiKeyInput.type === 'password') {
    openaiApiKeyInput.type = 'text';
  } else {
    openaiApiKeyInput.type = 'password';
  }
});

// Toggle Gemini API key visibility
toggleGeminiKeyVisibility.addEventListener('click', () => {
  if (geminiApiKeyInput.type === 'password') {
    geminiApiKeyInput.type = 'text';
  } else {
    geminiApiKeyInput.type = 'password';
  }
});

// Event listeners
providerSelect.addEventListener('change', saveProvider);
modelSelect.addEventListener('change', saveModel);
languageSelect.addEventListener('change', saveLanguage);
openaiApiKeyInput.addEventListener('input', saveOpenAIKey);
geminiApiKeyInput.addEventListener('input', saveGeminiKey);
extensionToggle.addEventListener('change', (e) => toggleExtension(e.target.checked));

// Initialize on load
init();
