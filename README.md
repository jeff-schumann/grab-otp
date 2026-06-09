# Grab OTP

A cross-browser WebExtension that automatically retrieves OTP codes from Gmail based on the active website's domain.

## Features

- 🔐 **Auto OTP Detection** - Finds verification codes in Gmail emails matching your current website
- 📋 **Clipboard Copy** - Automatically copies OTP codes to clipboard  
- ⚡ **Auto-Fill** - Fills OTP codes directly into website forms where supported
- 🛡️ **Security First** - Minimal permissions, OAuth 2.0, no sensitive data logging
- 🌐 **Cross-Browser** - Works on Chrome, Firefox, and Safari

## How It Works

1. Visit a website (e.g., bank.com)
2. Click the extension icon
3. Extension searches Gmail for recent emails from @bank.com
4. Extracts OTP codes and copies to clipboard
5. Auto-fills into website forms (where supported)

## Installation

### From Source (Recommended)

**Prerequisites:**
- Node.js 18+ (Node.js 22 LTS recommended)
- npm (comes with Node.js)

**Build Steps:**
```bash
# Clone the repository
git clone https://github.com/jefe-johann/grab-otp.git
cd grab-otp

# Install dependencies
npm install

# Build for your browser
npm run build:chrome   # For Chrome/Edge/Brave
npm run build:firefox  # For Firefox
npm run package:safari # For Safari
```

**Loading in Chrome:**
1. Open `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the `dist/chrome` directory

**Loading in Firefox:**
1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Navigate to `dist/firefox` and select `manifest.json`

**Note:** Firefox temporary extensions are removed when the browser closes. For persistent installation, use `web-ext` to create a signed `.xpi` file.

**Loading in Safari:**
1. Set `SAFARI_CLIENT_ID` in `.env` using a Google native/macOS OAuth client.
2. Run `npm run package:safari`.
3. Open `safari/Grab OTP/Grab OTP.xcodeproj` in Xcode.
4. Build and run the `Grab OTP` app, then enable the extension in Safari Settings.

Safari's OAuth redirect URI is derived from the client ID as `com.googleusercontent.apps.<client-id-prefix>:/oauth2redirect`.

### From GitHub Releases
1. Download the latest release from [Releases](https://github.com/jefe-johann/grab-otp/releases)
2. Unzip the extension files
3. Follow the browser-specific loading instructions above

## Privacy & Security

- **Local Processing**: All OTP extraction happens in your browser
- **Minimal Permissions**: Only accesses what's necessary
- **OAuth 2.0**: Secure Gmail authentication via Google
- **No Data Collection**: Extension doesn't collect or transmit personal data

See [Privacy Policy](PRIVACY_POLICY.md) for full details.

> **On the bundled OAuth client secret:** the secret shipped in the built
> extension is *intentionally* non-confidential — the flow is secured by PKCE and
> a locked redirect URI, not by hiding the secret. See
> [docs/OAUTH_SETUP.md](docs/OAUTH_SETUP.md#-security-the-client-secret-is-not-confidential)
> before reporting it as a vulnerability.

## Browser Support

| Feature | Chrome | Firefox | Safari |
|---------|--------|---------|--------|
| OTP Detection | ✅ | ✅ | ✅ |
| Clipboard Copy | ✅ | ✅ | ✅ |
| Auto-Fill | ✅ | ✅ | ✅ |
| Badge Notifications | ✅ | ✅ | ✅ |

## Development

**Environment Setup:**
```bash
# Install dependencies
npm install

# Build commands
npm run build         # Build Chrome, Firefox, and Safari versions
npm run build:chrome  # Build Chrome version only
npm run build:firefox # Build Firefox version only
npm run build:safari  # Build Safari web extension resources only
npm run package:safari # Build and sync Safari resources into Xcode

# Development
npm run dev          # Watch mode for development

# Quality checks
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint code linting
npm run test         # Run test suite
```

**OAuth Setup:**

The extension includes a default OAuth client that works out-of-the-box for most users. However:

**⚠️ IMPORTANT FOR FORKED VERSIONS:**
If you fork this project and redistribute it, you **MUST** use your own OAuth credentials:
1. Create a project in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the Gmail API
3. Create OAuth 2.0 credentials for each browser: Chrome extension for Chrome, Web application for Firefox, and a native/macOS app client for Safari
4. Set authorized redirect URI: `https://{your-extension-id}.extensions.allizom.org/` (Firefox), `https://{your-extension-id}.chromiumapp.org/` (Chrome), or `com.googleusercontent.apps.<client-id-prefix>:/oauth2redirect` (Safari)
5. Set environment variables before building:
   ```bash
   export FIREFOX_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   export CHROME_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   export SAFARI_CLIENT_ID="your-native-client-id.apps.googleusercontent.com"
   npm run build
   ```

**Why?** If you use the default OAuth client in your fork:
- Your users consume MY API quota (you're freeloading)
- I can revoke the OAuth client at any time, breaking your fork instantly
- Your users will blame you when it stops working

**Set up your own OAuth client or risk your fork breaking without warning.**

**Project Structure:**
- `src/` - TypeScript source code
- `dist/chrome/` - Built Chrome extension
- `dist/firefox/` - Built Firefox extension
- `dist/safari/` - Built Safari extension resources
- `safari/` - Safari wrapper app and Xcode project
- `docs/` - Documentation and development notes

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test on both Chrome and Firefox
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- 🐛 [Report Issues](https://github.com/jefe-johann/grab-otp/issues)
- 💡 [Feature Requests](https://github.com/jefe-johann/grab-otp/issues/new)
