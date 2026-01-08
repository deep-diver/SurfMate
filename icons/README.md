# Extension Icons

This directory should contain PNG icons for the Chrome extension.

## Required Files

- `icon16.png` - 16x16 pixels
- `icon48.png` - 48x48 pixels
- `icon128.png` - 128x128 pixels

## Creating the Icons

You can create these icons from the SVG file using one of these methods:

### Method 1: Using online tools
1. Visit https://cloudconvert.com/svg-to-png
2. Upload `icon.svg`
3. Set size to 128x128
4. Download and rename to `icon128.png`
5. Repeat for 16x16 and 48x48

### Method 2: Using ImageMagick (CLI)
```bash
# Install ImageMagick first, then run:
convert icon.svg -resize 16x16 icon16.png
convert icon.svg -resize 48x48 icon48.png
convert icon.svg -resize 128x128 icon128.png
```

### Method 3: Using Figma/Sketch/Photoshop
1. Open `icon.svg` in your design tool
2. Export as PNG at the required sizes
3. Place in this directory

## Temporary Placeholder

While creating proper icons, you can use any 16x16, 48x48, and 128x128 PNG files as placeholders. The extension will still function correctly.
