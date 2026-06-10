# Privacy Policy for Grab OTP

**Last Updated**: June 10, 2026
**Version**: 1.1.0

## Overview

Grab OTP is a browser extension for Chrome-compatible browsers, Firefox, and Safari. It helps retrieve one-time password (OTP) codes from a Gmail account you connect, then copies or fills the code on the website you are using.

Grab OTP does not operate its own server, analytics service, ad network, or data broker integration. The extension runs in your browser, stores its settings locally, and only contacts the third-party services needed for the product to work: Google for Gmail/OAuth and GitHub for optional update checks.

This policy describes the data the extension handles, why it handles it, where it is stored, and the choices available to you.

## Data Grab OTP Handles

### Gmail Account and Authentication Data

When you add a Gmail account, Grab OTP uses Google OAuth to request Gmail read-only access.

Grab OTP stores the following locally in your browser extension storage:

- Gmail account email address
- OAuth access token and expiration time
- OAuth refresh token, when Google provides one
- Granted OAuth scopes
- Active account selection
- Account added and last-used timestamps

This data is used only to authenticate with Google, keep your Gmail connection working, and let you choose between connected accounts.

### Gmail Message Data

When you request a code, Grab OTP searches Gmail for recent messages related to the website you are using.

- The extension builds a Gmail search query from the current website domain.
- The search is limited to recent mail, currently messages newer than 30 minutes.
- Grab OTP asks Gmail for up to 10 matching message IDs and checks up to 5 message details for an OTP.
- Message snippets and message text returned by Gmail are processed locally in your browser to find an OTP.
- Full email content is not stored permanently and is not sent to any server controlled by Grab OTP.

Grab OTP uses the Gmail API scope `https://www.googleapis.com/auth/gmail.readonly`, which allows the extension to view Gmail messages and settings. Grab OTP does not request permission to send, delete, modify, or permanently remove email.

### Current Website and Auto-Fill Data

When you click the extension, Grab OTP reads the active tab's website domain so it can search Gmail for messages that appear related to that site.

If auto-fill is enabled, the extension may temporarily inspect the current page's form fields, field labels, field attributes, nearby text, and current input values to identify the most likely OTP field. This inspection happens locally in the browser tab. Grab OTP uses it only to decide where to place the OTP and does not send page form data to Grab OTP servers.

### OTP Codes

When Grab OTP finds a code, it may:

- Display the code in the extension popup
- Copy the code to your clipboard
- Fill the code into the current web page if auto-fill is enabled
- Temporarily store the latest result in local extension storage so the popup can recover from sign-in or browser popup interruptions

Latest OTP results are designed to be short-lived. The popup normally removes them after display or after the auto-fill recovery window. If the browser closes before cleanup happens, stale results are removed the next time the extension checks them or when a new OTP request starts.

### User Settings

Grab OTP stores these settings locally in your browser:

- Auto-fill enabled or disabled
- Domain override rules you create
- Cached update-check information
- Whether a recent update notice has already been shown

These settings are not sent to Grab OTP servers.

## Third-Party Services

### Google

Grab OTP contacts Google services for:

- OAuth sign-in and token refresh
- OAuth token scope validation
- Reading the connected account email address
- Gmail searches and message retrieval through the Gmail API

Google receives the information required for those requests, such as OAuth tokens, Gmail API requests, Gmail search queries, message IDs requested, and normal network metadata. Google's handling of that information is governed by [Google's Privacy Policy](https://policies.google.com/privacy).

Grab OTP's use of Google user data is limited to providing and improving the extension's user-facing OTP retrieval and auto-fill features. Grab OTP does not sell Google user data, use it for advertising, transfer it to data brokers, or allow humans to read Gmail data except if required for security, legal compliance, or with your explicit consent.

### GitHub

Grab OTP may check the latest public GitHub release for update notices. This request does not intentionally include Gmail data, OTP codes, website form data, or your extension settings. GitHub may receive normal network metadata such as IP address and user agent. GitHub's handling of that information is governed by the [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

### Safari Native Messaging

On Safari, Grab OTP uses the Safari wrapper app and native messaging to complete the Google OAuth flow. This communication stays between the Safari extension and the local Safari app wrapper on your device.

## What Grab OTP Does Not Do

Grab OTP does not:

- Sell personal data
- Use data for advertising, retargeting, or profiling
- Use analytics or behavioral tracking
- Send Gmail content, OTP codes, browsing history, or form data to a Grab OTP server
- Share Gmail data with data brokers or advertising platforms
- Modify, send, delete, archive, or label Gmail messages
- Intentionally collect passwords, payment card numbers, government IDs, health data, or precise location

## Local Storage and Retention

Grab OTP uses browser extension storage on your device.

- Gmail account tokens and account email addresses remain until you remove the account, clear extension data, or uninstall the extension.
- User settings and domain overrides remain until you change them, clear extension data, or uninstall the extension.
- OTP results are temporary and intended only for short popup recovery windows.
- Update-check results are cached locally to avoid repeated GitHub requests.

Uninstalling the extension removes extension-local data from the browser. Removing an account from Grab OTP removes the local account data from the extension, but you should also revoke access in your Google Account if you want Google to invalidate the authorization.

## Security

Grab OTP uses:

- Google OAuth 2.0 and PKCE-based authentication flows
- HTTPS requests to Google and GitHub
- Read-only Gmail access
- Local browser extension storage for settings and tokens
- Minimal browser permissions for the extension's stated features

No system can guarantee absolute security. Keep your browser, operating system, and extension version up to date.

## Browser Permissions Explained

Grab OTP requests permissions for the following purposes:

- **activeTab**: Read the current website and run the auto-fill helper only after you interact with the extension.
- **tabs**: Identify the active tab and its domain.
- **storage**: Store account connection data, settings, temporary OTP results, and update-check cache locally.
- **identity**: Start browser-supported OAuth sign-in flows.
- **scripting**: Inject the OTP auto-fill helper into the current page when needed.
- **alarms**: Refresh OAuth tokens and schedule non-critical background work.
- **clipboardWrite**: Copy OTP codes to your clipboard.
- **nativeMessaging**: Complete Safari OAuth through the local Safari wrapper app.
- **Google host permissions**: Communicate with Google OAuth and Gmail API endpoints.
- **Optional website permissions on Firefox**: Support user-initiated auto-fill or clipboard helper injection on the current site.

## Your Choices and Controls

You can:

- Disable auto-fill in the extension popup.
- Remove a Gmail account from Grab OTP.
- Revoke Grab OTP's Google access from your Google Account.
- Clear or replace the copied OTP in your clipboard after use.
- Clear extension data in your browser.
- Uninstall the extension.

To revoke Google access:

1. Go to [Google Account Security](https://myaccount.google.com/security).
2. Open "Your connections to third-party apps & services" or the current Google account access section.
3. Find Grab OTP.
4. Remove access.

Depending on your location, you may have additional privacy rights. Because Grab OTP does not run user accounts or a developer-controlled data server, most access, deletion, and correction controls are handled locally in your browser or through your Google Account.

## Children's Privacy

Grab OTP is not intended for children under 13. We do not knowingly collect personal information from children under 13.

## Changes to This Policy

We may update this privacy policy as the extension, browser store requirements, or third-party service requirements change. When we update it, we will change the "Last Updated" date above. Significant product data-use changes should be reflected in the extension, store listing, or release notes before the changed behavior is used.

## Contact

If you have questions about this policy or Grab OTP's privacy practices, open an issue in the project repository:

[https://github.com/jefe-johann/grab-otp/issues](https://github.com/jefe-johann/grab-otp/issues)
