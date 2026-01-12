# SurfMate

> AI-powered keyboard navigation for the web

SurfMate is a Chrome extension that uses AI (OpenAI GPT or Google Gemini) to analyze web pages and provide intelligent keyboard navigation. It automatically identifies containers, interactive elements, and actions on any page, letting you navigate using only your keyboard.

![Container Level](container-level.png)
*Container-level navigation with numbered containers and hand-drawn borders*

![Inner Container Level](inner-container-level.png)
*Vimium-style hints for elements within a container*

## Features

- **Two-Level Navigation**: Navigate containers first (1-9), then elements inside (a-z)
- **AI-Powered Analysis**: Uses LLMs to understand page structure and element context
- **Smart Collision Handling**: Hints automatically reposition to avoid overlaps
- **Magnificent Night Sky Background**: Beautiful cosmic atmosphere with twinkling stars, shooting stars, and nebula clouds
- **Adaptive Background**: Solid night sky during loading, transparent after analysis completes
- **Exact Search**: Prefix-based search for precise element matching
- **Multi-Language Support**: English and Korean labels
- **Multiple AI Providers**: Support for OpenAI (GPT-5.2, o3, o3-mini, etc.) and Google Gemini (3.0 Flash)
- **Exact Bounding Boxes**: Visual feedback showing exactly what will be activated
- **Rate Limiting Protection**: Built-in request queue with automatic retry logic
- **Structured Output**: Uses JSON schemas for reliable API responses

## Installation

### From Source

1. Clone this repository:
```bash
git clone https://github.com/deep-diver/SurfMate.git
cd SurfMate
```

2. Open Chrome and navigate to `chrome://extensions`

3. Enable "Developer mode" (toggle in top-right)

4. Click "Load unpacked" and select the `SurfMate` directory

### Configuration

1. Click the SurfMate extension icon in Chrome's toolbar
2. Enter your API keys (separate fields for each provider):
   - **OpenAI**: Get your key from [platform.openai.com](https://platform.openai.com)
   - **Gemini (Google AI)**: Get your key from [aistudio.google.com](https://aistudio.google.com)
3. Select your preferred provider and model
4. Choose your language (English or Korean)
5. Toggle "Enable Annotations" to activate

## Usage

### Basic Navigation

1. **Activate**: Press `Option+Shift+B` (Mac) or `Ctrl+Shift+B` (Windows/Linux) to toggle SurfMate
2. **Container Level**: Press `1-9` to select a numbered container
3. **Element Level**: Press `a-z` to select an element within the container
4. **Go Back**: Press `Escape` to return to container level
5. **Search**: Press `/` to open command palette and search for actions
6. **Refresh**: Press `R` to re-analyze the current page

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Option+Shift+B` / `Ctrl+Shift+B` | Toggle SurfMate on/off |
| `1-9` | Select container (at container level) |
| `a-z`, `A-Z` | Select element (within container) |
| `Escape` | Go back to container level |
| `/` | Open search/command palette |
| `R` | Refresh page analysis |
| `?` | Show help (coming soon) |

### How It Works

1. **Page Analysis**: When activated, SurfMate sends a snapshot of the page to an AI model
2. **Container Detection**: The AI identifies semantic sections (navigation, main content, sidebars, etc.)
3. **Element Discovery**: When you enter a container, SurfMate dynamically finds all interactive elements
4. **Smart Labeling**: The AI generates meaningful, action-oriented labels (not just "button" or "link")
5. **Workflow Ordering**: Containers and elements are ordered based on logical user workflow

### Visual Experience

- **During Loading**: Solid night sky background with visible stars and nebula clouds
- **After Loading**: Background becomes transparent, showing underlying content with subtle star overlay
- **Smooth Transitions**: Automatic background adaptation as analysis completes

## Configuration Options

### API Providers

**OpenAI Models:**
- `gpt-5.2` - Latest, most powerful (recommended)
- `gpt-5-mini` - Fast and cost-efficient
- `o3`, `o3-mini` - Advanced reasoning
- `gpt-4.1`, `gpt-4.1-mini` - Developer series

**Gemini (Google AI) Models:**
- `gemini-3-flash-preview` - Fast and efficient (recommended)

### Language Support

- **English**: Natural English phrases for labels
- **Korean (한국어)**: Natural Korean phrases with appropriate character lengths

## Development

### Project Structure

```
SurfMate/
├── manifest.json          # Chrome extension manifest
├── background.js          # Service worker for API calls
├── content.js            # Content script for DOM analysis & overlay
├── popup.html            # Settings popup UI
├── popup.js              # Settings logic
├── styles.css            # Overlay and animation styles
└── icons/                # Extension icons
```

### Key Components

- **background.js**: Handles AI API calls with caching, provider management, and request queue
- **content.js**: DOM analysis, vimium-style hints, collision detection
- **popup.html/js**: Settings UI with separate API key inputs for each provider

### Building

No build step required! This is a vanilla JavaScript Chrome extension.

### Testing

1. Load the extension in Chrome
2. Navigate to any website
3. Press `Option+Shift+B` to activate
4. Try the keyboard shortcuts

## Technical Details

### AI Prompt Strategy

SurfMate uses structured prompts with JSON schemas for consistent responses:

```javascript
{
  "containers": [
    { "selector": "nav", "label": "Navigation menu", "type": "navigation" }
  ],
  "standalone": [
    { "selector": "button.submit", "label": "Submit form", "type": "button" }
  ]
}
```

### Request Queue & Rate Limiting

- Sequential request processing to prevent rate limiting
- 500ms delay between requests for Gemini API
- Automatic retry with exponential backoff (1s, 2s, 4s) on 429 errors
- Request caching with 5-minute TTL

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

### Night Sky Background

The overlay features a magnificent night sky atmosphere:
- **Multi-layered star field**: Four depth layers creating realistic 3D effect
- **Twinkling stars**: Dynamic animations with varying brightness
- **Shooting stars**: Occasional meteors streaking across the sky
- **Nebula clouds**: Subtle cosmic gas clouds with breathing animations
- **Adaptive transparency**: Solid background during loading, transparent after analysis

### Star Animations

Enhanced sparkle effects with:
- Dynamic size ranges (0.5x to 2.5x scale)
- Multi-color bursts (white, green, yellow, pink)
- Rotation and brightness effects
- Multiple animation types: `sparkle`, `twinkle`, `sparkleBurst`, `microSparkle`, `shootingStar`, `starGlow`, `rainbowShimmer`, `floatParticle`

## Privacy & Security

- **API Keys**: Stored locally in `chrome.storage.local` - never sent anywhere except to your chosen AI provider
- **Separate Storage**: OpenAI and Gemini API keys are stored independently
- **Page Data**: Only DOM snapshots are sent to the AI - no tracking, no analytics
- **No Server**: No backend - all processing happens through your chosen AI provider
- **Thinking Mode**: Disabled by default for Gemini for faster responses

## Troubleshooting

**Hints not appearing?**
- Check that you've entered a valid API key for the selected provider
- Try refreshing the page (press `R`)
- Check the browser console for errors

**Rate limit errors (429)?**
- The extension automatically retries with exponential backoff
- Wait ~60 seconds if you've made many rapid requests
- Consider using a different provider/model

**Incorrect element selection?**
- Press `R` to re-analyze the page
- Try a different AI model (GPT-5.2 works best for OpenAI)

**Selector errors in console?**
- The extension automatically sanitizes invalid selectors
- Errors are logged but won't break functionality

## Roadmap

- [ ] Help modal with full keyboard reference
- [ ] Customizable keyboard shortcuts
- [ ] Session persistence (remember navigation state)
- [ ] Visual history of visited elements
- [ ] Export/import settings

## License

MIT License - see LICENSE file for details

## Contributing

Contributions welcome! Please feel free to submit issues or pull requests.

---

**Made with ❤️ for keyboard surfers**
