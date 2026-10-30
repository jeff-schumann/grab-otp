import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';

const target = process.env.TARGET || 'chrome';
const isFirefox = target === 'firefox';
const isSafari = target === 'safari';

// OAuth credentials each target needs baked in. Safari uses a native-app client,
// which has no secret.
const REQUIRED_CREDENTIALS: Record<string, string[]> = {
  chrome: ['CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET'],
  firefox: ['FIREFOX_CLIENT_ID', 'FIREFOX_CLIENT_SECRET'],
  safari: ['SAFARI_CLIENT_ID']
};

const CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

/**
 * Fail a production build whose credentials are unusable.
 *
 * `loadEnv` returns nothing for a file it cannot read, and the `define` block
 * below falls back to '' — so a build with no readable .env used to succeed and
 * emit an extension that asks Google for a token with an empty client_id. Every
 * sign-in then dies with "Error 400: invalid_request", which looks like a
 * console misconfiguration rather than a bad build. One signed and submitted
 * Firefox release was spent that way before the cause was found.
 *
 * Development builds only warn, so UI work does not need credentials. So do
 * builds that set ALLOW_MISSING_OAUTH_CREDENTIALS, which CI uses to check that
 * the extension still compiles without handing fork pull requests the secrets.
 * Never set it when building something you intend to install or ship.
 */
function checkCredentials(env: Record<string, string>, mode: string): void {
  const problems: string[] = [];

  for (const key of REQUIRED_CREDENTIALS[target] ?? []) {
    const value = env[key]?.trim();
    if (!value) {
      problems.push(`${key} is missing or empty`);
    } else if (value.startsWith('your-')) {
      problems.push(`${key} is still the placeholder from .env.example`);
    } else if (key.endsWith('_CLIENT_ID') && !value.endsWith(CLIENT_ID_SUFFIX)) {
      problems.push(`${key} does not end in ${CLIENT_ID_SUFFIX}`);
    }
  }

  if (problems.length === 0) return;

  const message = [
    `Cannot build the ${target} extension — OAuth credentials are unusable:`,
    ...problems.map(problem => `  - ${problem}`),
    '',
    'Copy .env.example to .env and fill in your Google OAuth credentials',
    '(Google Cloud Console > APIs & Services > Credentials). In CI, pass them',
    'as environment variables.',
    '',
    'Building without them produces an extension that fails every sign-in with',
    'Google "Error 400: invalid_request".'
  ].join('\n');

  const compileOnly = env.ALLOW_MISSING_OAUTH_CREDENTIALS === '1';
  if (mode === 'production' && !compileOnly) throw new Error(`\n${message}\n`);
  console.warn(`\n[vite] WARNING - ${message}\n`);
}

export default defineConfig(({ mode }) => {
  // Load env file based on mode (development/production)
  const env = loadEnv(mode, process.cwd(), '');
  checkCredentials(env, mode);
  const rollupInput: Record<string, string> = {
    background: isFirefox
      ? resolve(__dirname, 'src/background/background-firefox.ts')
      : isSafari
        ? resolve(__dirname, 'src/background/background-safari.ts')
        : resolve(__dirname, 'src/background/background.ts'),
    popup: isFirefox
      ? resolve(__dirname, 'src/popup/popup-firefox.ts')
      : resolve(__dirname, 'src/popup/popup.ts')
  };

  // Each target gets exactly one bridge entry so the shared otp-finder module
  // is inlined into it. A module imported by 2+ entries would be hoisted into a
  // separate chunk, which breaks executeScript-injected content scripts that
  // cannot resolve ES imports at runtime.
  if (isFirefox) {
    rollupInput['otp-bridge-firefox'] = resolve(__dirname, 'src/content/otp-bridge-firefox.ts');
  } else {
    rollupInput['otp-bridge'] = resolve(__dirname, 'src/content/otp-bridge.ts');
  }

  return {
    build: {
      rollupOptions: {
        input: rollupInput,
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
          assetFileNames: '[name].[ext]',
          // Inline all modules into each entry point to avoid ES module imports
          manualChunks: () => null
        }
      },
      outDir: 'dist',
      emptyOutDir: true,
      target: 'es2017',
      lib: false
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    define: {
      __CHROME_CLIENT_ID__: JSON.stringify(env.CHROME_CLIENT_ID || ''),
      __CHROME_CLIENT_SECRET__: JSON.stringify(env.CHROME_CLIENT_SECRET || ''),
      __FIREFOX_CLIENT_ID__: JSON.stringify(env.FIREFOX_CLIENT_ID || ''),
      __FIREFOX_CLIENT_SECRET__: JSON.stringify(env.FIREFOX_CLIENT_SECRET || ''),
      __SAFARI_CLIENT_ID__: JSON.stringify(env.SAFARI_CLIENT_ID || ''),
      __SAFARI_APP_BUNDLE_ID__: JSON.stringify(env.SAFARI_APP_BUNDLE_ID || 'com.jeff.grabotp.safari.Extension')
    },
    plugins: [
      {
        name: 'copy-extension-files',
        generateBundle(_options, bundle) {
          for (const fileName of ['otp-bridge.js', 'otp-bridge-firefox.js']) {
            const chunk = bundle[fileName];
            if (chunk?.type === 'chunk') {
              // executeScript can inject the bridge repeatedly into the same
              // isolated world. Keep generated top-level const/function names
              // scoped so a later injection can reach the runtime guard.
              chunk.code = `(() => {\n${chunk.code}\n})();\n`;
            }
          }
        },
        writeBundle(options) {
          const distDir = options.dir || resolve(__dirname, 'dist');

          // Copy and process appropriate manifest with client ID injection
          const manifestSrc = isFirefox
            ? resolve(__dirname, 'src/manifest-firefox.json')
            : isSafari
              ? resolve(__dirname, 'src/manifest-safari.json')
              : resolve(__dirname, 'src/manifest.json');

          let manifestContent = readFileSync(manifestSrc, 'utf8');

          // Replace client ID placeholders with environment variables
          const chromeClientId = env.CHROME_CLIENT_ID || '';
          const firefoxClientId = env.FIREFOX_CLIENT_ID || '';

          manifestContent = manifestContent.replace('__CHROME_CLIENT_ID__', chromeClientId);
          manifestContent = manifestContent.replace('__FIREFOX_CLIENT_ID__', firefoxClientId);

          writeFileSync(resolve(distDir, 'manifest.json'), manifestContent);

          // Copy appropriate popup HTML for each browser
          const popupHtmlSrc = isFirefox
            ? resolve(__dirname, 'src/popup/popup.html')  // Firefox uses polyfill
            : resolve(__dirname, 'src/popup/popup-chrome.html');  // Chrome/Safari use native APIs

          copyFileSync(popupHtmlSrc, resolve(distDir, 'popup.html'));

          // Copy shared popup stylesheet (referenced by both popup variants)
          copyFileSync(
            resolve(__dirname, 'src/popup/popup.css'),
            resolve(distDir, 'popup.css')
          );

          // Create icons directory and copy icons
          const iconsDir = resolve(distDir, 'icons');
          if (!existsSync(iconsDir)) {
            mkdirSync(iconsDir, { recursive: true });
          }

          [16, 32, 48, 128].forEach(size => {
            const srcIcon = resolve(__dirname, `src/icons/icon${size}.png`);
            const distIcon = resolve(iconsDir, `icon${size}.png`);
            if (existsSync(srcIcon)) {
              copyFileSync(srcIcon, distIcon);
            }
          });

          // Copy browser-polyfill.js only for Firefox (background script needs it)
          if (isFirefox) {
            const polyfillSrc = resolve(__dirname, 'node_modules/webextension-polyfill/dist/browser-polyfill.js');
            const polyfillDist = resolve(distDir, 'browser-polyfill.js');
            if (existsSync(polyfillSrc)) {
              copyFileSync(polyfillSrc, polyfillDist);
            }
          }

          console.log(`✓ ${target} extension files copied`);
        }
      }
    ]
  };
});
