# SMS OTP Setup

How to feed SMS one-time codes into Grab OTP. Many services now send codes by
text instead of email; this bridges those texts into Gmail so the extension's
**"Grab SMS code"** button can fill them like any other code.

## How it works

```
Phone receives SMS
   │  (MacroDroid macro, filtered to code-like texts)
   ▼
HTTP POST  ──►  Google Apps Script web app (runs as you)
                   │  emails the text to yourself
                   ▼
                Gmail, subject "GRABOTP-SMS"
                   │
                   ▼
   Extension "Grab SMS code" button  ──►  fills / copies the code
```

Nothing sensitive is stored on the phone — the relay is a script in your own
Google account. The extension finds these messages by their fixed subject and
ignores the website domain (SMS codes aren't tied to a sender domain), so it
grabs the **most recent** forwarded code, with a 10-minute freshness limit.

The subject tag is defined once in code as `SMS_SUBJECT_TAG` in
`src/background/gmail-query.ts`. **If you change it there, change it in the
Apps Script too** — they're matched by string across two systems.

---

## Part 1 — Google Apps Script relay

1. Go to [script.google.com](https://script.google.com) → **New project**.
2. Generate a shared secret on your machine and keep it handy:
   ```
   openssl rand -hex 24
   ```
3. Paste this in, replacing `PASTE_YOUR_SECRET_HERE` and confirming the email:

   ```javascript
   var SHARED_SECRET = 'PASTE_YOUR_SECRET_HERE';
   var SUBJECT_TAG   = 'GRABOTP-SMS';
   var RECIPIENT     = 'you@gmail.com';   // where the forwarded code is emailed

   function doGet() {
     return ContentService.createTextOutput('Grab OTP relay is live.');
   }

   function doPost(e) {
     try {
       var p = (e && e.parameter) || {};
       if (p.token !== SHARED_SECRET) {
         return ContentService.createTextOutput('forbidden');
       }
       var body   = (e.postData && e.postData.contents) || '';
       var sender = p.sender || 'unknown';
       GmailApp.sendEmail(RECIPIENT, SUBJECT_TAG, 'From ' + sender + '\n\n' + body);
       return ContentService.createTextOutput('ok');
     } catch (err) {
       return ContentService.createTextOutput('error: ' + err);
     }
   }
   ```

4. **Deploy → New deployment**, gear ⚙ → **Web app**.
   - **Execute as:** Me
   - **Who has access:** **Anyone** (not "Anyone with Google account" — that
     forces a login and the phone request gets a 401)
5. **Deploy**, then **Authorize access** and approve (the "unverified app"
   warning is expected for your own script — continue).
6. Copy the **Web app URL** — it ends in **`/exec`** (the `/dev` URL is private
   and always returns 401; don't use it).
7. Test: open the `/exec` URL in a browser. You should see
   **"Grab OTP relay is live."**

> After any code edit you must redeploy a new version, or `/exec` keeps running
> the old code: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.**

---

## Part 2 — Forwarding SMS to Gmail

> **iOS:** No instructions are included here — this hasn't been tested on iPhone.
> That said, the same Apps Script relay should work fine; you just need a way to
> forward incoming texts to it. iOS Shortcuts is the likely tool, though its
> message automations require a tap to confirm each run.

### Android — MacroDroid

Install [MacroDroid](https://play.google.com/store/apps/details?id=com.arlosoft.macrodroid),
then **Add Macro** (the **+**). A macro has a Trigger, Actions, and Constraints.
Name it `Forward OTP to Gmail`.

### Trigger
- **Call/SMS → SMS Received**
- **Number:** any
- **Content filter:** enable **regular expression matching**, leave
  **case insensitive** on, and enter:
  ```
  (otp|code|verif|passcode|\d{4,8})
  ```
  This forwards only code-like texts (deliberately a bit generous). Leave
  **Monitor inbox** off unless texts don't trigger the macro.

  *(If the keyboard won't focus in the filter box — a known glitch — rotate to
  landscape, tap twice, or switch keyboards.)*

### Action
Add one action. Use the **search icon** at the top of the action list and type
**HTTP** if you can't find it by category.

- **HTTP Request**
  - **Method:** POST
  - **URL:** `https://YOUR-SCRIPT-URL/exec?token=YOUR_SHARED_SECRET&sender={sms_number}`
  - **Content Type:** `text/plain`
  - **Body / Content:** `{sms_message}` (insert via the magic-text button)

All the other HTTP Request fields (headers, basic auth, save-to-variable, etc.)
stay at their defaults. Save the macro and grant the **SMS** permission when
prompted.

> Sending the raw message as the body means there's nothing to URL-encode; the
> token and sender ride in the URL.

### Test
Text yourself *"Your code is 123456"*. Within a few seconds it should arrive in
Gmail under the subject **GRABOTP-SMS**.

---

## Part 3 — Using it in the extension

1. Reload the extension after building (`npm run build`).
2. When a code arrives by SMS, open the Grab OTP popup and click
   **Grab SMS code**.
3. With **Auto-fill** on, the code drops into the active field; otherwise it's
   copied to the clipboard. Codes older than **10 minutes** are ignored.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| HTTP **401** in the MacroDroid log | URL ends in `/dev` (use `/exec`), or deployment access isn't **Anyone**. |
| HTTP **200** but no email | The response body tells you why. Add **Save response into variable** + a **Toast** in MacroDroid to see it: `forbidden` = token mismatch; `error: no email recipient` = `RECIPIENT` not set (anonymous web apps can't read the caller's address, so it must be hardcoded). |
| Macro log shows trigger but no request | SMS permission not granted, or the content-filter regex didn't match. |
| Nothing forwards at all | Trigger didn't fire — check the SMS permission and that the macro is enabled. |
| Email arrives but button finds nothing | Subject mismatch (`SUBJECT_TAG` vs `SMS_SUBJECT_TAG`), or the code is older than the 10-minute window. |
