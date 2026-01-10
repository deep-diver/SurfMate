# SurfMate

> AI-powered keyboard navigation for the web

SurfMate is a Chrome extension that uses AI (OpenAI GPT or Groq) to analyze web pages and provide intelligent keyboard navigation. It automatically identifies containers, interactive elements, and actions on any page, letting you navigate using only your keyboard.

![Container Level](container-level.png)
*Container-level navigation with numbered containers and hand-drawn borders*

![Inner Container Level](inner-container-level.png)
*Vimium-style hints for elements within a container*

## Features

- **Two-Level Navigation**: Navigate containers first (1-9), then elements inside (a-z)
- **AI-Powered Analysis**: Uses LLMs to understand page structure and element context
- **Smart Collision Handling**: Hints automatically reposition to avoid overlaps
- **Hand-Drawn Aesthetic**: Sketchy borders and doodle-style UI with sparkle effects
- **Multi-Language Support**: English and Korean labels
- **Multiple AI Providers**: Support for OpenAI (GPT-5.2, o3, o3-mini, etc.) and Groq
- **Exact Bounding Boxes**: Visual feedback showing exactly what will be activated

## Installation

### From Source

1. Clone this repository:
```bash
git clone https://github.com/your-username/surfermate.git
cd surfermate
```

2. Open Chrome and navigate to `chrome://extensions`

3. Enable "Developer mode" (toggle in top-right)

4. Click "Load unpacked" and select the `surfermate` directory

### Configuration

1. Click the SurfMate extension icon in Chrome's toolbar
2. Enter your API key:
   - **OpenAI**: Get your key from [platform.openai.com](https://platform.openai.com)
   - **Groq**: Get your key from [console.groq.com](https://console.groq.com)
3. Select your preferred provider and model
4. Choose your language (English or Korean)
5. Toggle "Enable Annotations" to activate

## Usage

### Basic Navigation

1. **Activate**: Press `Option+Shift+B` (Mac) or `Ctrl+Shift+B` (Windows/Linux) to toggle Browse
2. **Container Level**: Press `1-9` to select a numbered container
3. **Element Level**: Press `a-z` to select an element within the container
4. **Go Back**: Press `Escape` to return to container level
5. **Search**: Press `/` to open command palette and search for actions
6. **Refresh**: Press `R` to re-analyze the current page

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Option+Shift+B` / `Ctrl+Shift+B` | Toggle Browse on/off |
| `1-9` | Select container (at container level) |
| `a-z`, `A-Z` | Select element (within container) |
| `Escape` | Go back to container level |
| `/` | Open search/command palette |
| `R` | Refresh page analysis |
| `?` | Show help (coming soon) |

### How It Works

1. **Page Analysis**: When activated, Browse sends a snapshot of the page to an AI model
2. **Container Detection**: The AI identifies semantic sections (navigation, main content, sidebars, etc.)
3. **Element Discovery**: When you enter a container, Browse dynamically finds all interactive elements
4. **Smart Labeling**: The AI generates meaningful, action-oriented labels (not just "button" or "link")
5. **Workflow Ordering**: Containers and elements are ordered based on logical user workflow

## Configuration Options

### API Providers

**OpenAI Models:**
- `gpt-5.2` - Latest, most powerful (recommended)
- `gpt-5-mini` - Fast and cost-efficient
- `o3`, `o3-mini` - Advanced reasoning
- `gpt-4.1`, `gpt-4.1-mini` - Developer series

**Groq Models:**
- `openai/gpt-oss-20b` - Fastest (1000 tokens/sec)
- `meta-llama/llama-4-scout-17b` - High performance
- `llama-3.1-8b-instant` - Ultra-fast

### Language Support

- **English**: Natural English phrases for labels
- **Korean (한국어)**: Natural Korean phrases with appropriate character lengths

## Development

### Project Structure

```
browse/
├── manifest.json          # Chrome extension manifest
├── background.js          # Service worker for API calls
├── content.js            # Content script for DOM analysis & overlay
├── popup.html            # Settings popup UI
├── popup.js              # Settings logic
├── styles.css            # Overlay and animation styles
└── icons/                # Extension icons
```

### Key Components

- **background.js**: Handles AI API calls with caching and provider management
- **content.js**: DOM analysis, vimium-style hints, collision detection
- **popup.html/js**: Settings UI for API key, provider, model, and language

### Building

No build step required! This is a vanilla JavaScript Chrome extension.

### Testing

1. Load the extension in Chrome
2. Navigate to any website
3. Press `Option+Shift+B` to activate
4. Try the keyboard shortcuts

## Technical Details

### AI Prompt Strategy

Browse uses structured prompts to get consistent JSON responses:

```javascript
{
  "containers": [
    { "selector": "nav", "label": "Navigation menu", "type": "navigation" }
  ],
  "elements": [
    { "selector": "button.submit", "label": "Submit form", "type": "button" }
  ]
}
```

### Selector Handling

The extension intelligently handles:
- Duplicate selectors (uses nth-element logic)
- Tailwind CSS classes with special characters (escapes colons)
- Dynamic content (re-analyzes on significant changes)
- Invalid selectors (graceful fallback)

### Collision Detection

Hints use a smart positioning algorithm that tries 9 positions:
1. Center on element (preferred)
2. Above/below center
3. Left/right center
4. Four corners

This ensures all hints remain visible and don't overlap.

## Privacy & Security

- **API Keys**: Stored locally in `chrome.storage.local` - never sent anywhere except to your chosen AI provider
- **Page Data**: Only DOM snapshots are sent to the AI - no tracking, no analytics
- **No Server**: No backend - all processing happens through your chosen AI provider

## Troubleshooting

**Hints not appearing?**
- Check that you've entered a valid API key
- Try refreshing the page (press `R`)
- Check the browser console for errors

**Incorrect element selection?**
- Press `R` to re-analyze the page
- Try a different AI model (GPT-5.2 works best)

**Selector errors in console?**
- The extension automatically sanitizes invalid selectors
- Errors are logged but won't break functionality

## Roadmap

- [ ] Help modal with full keyboard reference
- [ ] Customizable keyboard shortcuts
- [ ] Session persistence (remember navigation state)
- [ ] More AI providers (Anthropic, etc.)
- [ ] Visual history of visited elements
- [ ] Export/import settings

## License

MIT License - see LICENSE file for details

## Contributing

Contributions welcome! Please feel free to submit issues or pull requests.

---

**Made with ❤️ for keyboard surfers**
