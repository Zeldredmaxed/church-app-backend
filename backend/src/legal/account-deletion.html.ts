// Web-accessible account-deletion landing page.
//
// Required by Google Play Console (since 2023) — every app with sign-up
// must publish a URL where users can request deletion *without* needing
// to install the app. Apple links here from the App Store privacy section
// for parity. The page explains the in-app path and provides a fallback
// email form for users who've lost access.
//
// The form submits to a mailto: link rather than POSTing — we deliberately
// don't expose an unauthenticated "delete by email" endpoint because we
// can't verify ownership of the email without sending a confirmation, and
// the in-app flow already covers the verified path. The mailto fallback
// is for users who genuinely can't reach the in-app flow.

export const ACCOUNT_DELETION_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Delete Your Account — Shepard</title>
  <style>
    body { margin: 0; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2933; max-width: 720px; margin-inline: auto; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    h2 { font-size: 20px; margin-top: 32px; }
    p, li { font-size: 16px; }
    a { color: #2563eb; }
    .panel { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 24px; margin-top: 16px; }
    .button {
      display: inline-block;
      background: #dc2626;
      color: #ffffff;
      padding: 12px 20px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      margin-top: 12px;
    }
    .button:hover { background: #b91c1c; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
    ol li { margin-bottom: 6px; }
  </style>
</head>
<body>
  <h1>Delete Your Shepard Account</h1>
  <p>You can permanently delete your Shepard account and the personal data we hold about you at any time. This page explains how — both from inside the app and via email if you've lost access.</p>

  <h2>Option 1 — Inside the app (recommended)</h2>
  <div class="panel">
    <ol>
      <li>Open the Shepard app and sign in.</li>
      <li>Tap your avatar in the top-right of the home screen.</li>
      <li>Choose <strong>Settings</strong> → <strong>Account</strong>.</li>
      <li>Tap <strong>Delete Account</strong>.</li>
      <li>Confirm the deletion. You'll be signed out immediately.</li>
    </ol>
    <p>Your account, posts, comments, chat messages, prayer requests, group memberships, and profile data are permanently deleted within 30 days. Financial records (donations) are retained in anonymized form for tax/legal compliance.</p>
  </div>

  <h2>Option 2 — If you've lost access</h2>
  <p>If you can no longer sign in to delete your account from inside the app, email us at <a href="mailto:privacy@shepardapp.com?subject=Account%20Deletion%20Request&body=I%20would%20like%20to%20delete%20my%20Shepard%20account.%0A%0AAccount%20email%3A%20%5Byour%20email%5D%0AFull%20name%20on%20account%3A%20%5Byour%20name%5D">privacy@shepardapp.com</a> with the subject line "Account Deletion Request" and include:</p>
  <ul>
    <li>The email address on your Shepard account</li>
    <li>The full name on your Shepard account</li>
    <li>(Optional) Reason for deletion — helps us improve</li>
  </ul>
  <p>We'll verify your identity by sending a confirmation link to the account email, then complete the deletion within 30 days of confirmation.</p>
  <p><a class="button" href="mailto:privacy@shepardapp.com?subject=Account%20Deletion%20Request&body=I%20would%20like%20to%20delete%20my%20Shepard%20account.%0A%0AAccount%20email%3A%20%5Byour%20email%5D%0AFull%20name%20on%20account%3A%20%5Byour%20name%5D">Email Deletion Request</a></p>

  <h2>What gets deleted</h2>
  <ul>
    <li>Profile (name, email, photo, all extended profile fields)</li>
    <li>Posts and comments you authored</li>
    <li>Chat messages you sent</li>
    <li>Prayer requests, event RSVPs, group memberships</li>
    <li>Follow relationships, likes, saves</li>
    <li>Push notification tokens and notification history</li>
  </ul>

  <h2>What is kept (in anonymized form)</h2>
  <ul>
    <li>Donation records — required for tax reporting and Stripe dispute resolution. Your name is removed; only the amount, date, and church remain on the record.</li>
  </ul>

  <h2>Questions</h2>
  <p>If you have questions or want to confirm a deletion was processed, email <a href="mailto:privacy@shepardapp.com">privacy@shepardapp.com</a>.</p>
</body>
</html>`;
