// Public privacy-policy landing page. Served at GET /api/legal/privacy-policy.
// Linked from the App Store / Play Store listings AND from inside the app.
// The URL is the same one we register on the store consoles, so it must
// stay stable.

export const PRIVACY_POLICY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy — Shepard</title>
  <style>
    body { margin: 0; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2933; max-width: 760px; margin-inline: auto; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    h2 { font-size: 20px; margin-top: 32px; }
    p, li { font-size: 16px; }
    a { color: #2563eb; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
    .updated { color: #64748b; font-size: 14px; margin-bottom: 24px; }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p class="updated">Last updated: May 14, 2026</p>

  <p>Shepard ("we," "our," "us") provides software for churches to manage their communities. This policy explains what data we collect, why, and how to control it.</p>

  <h2>1. What we collect</h2>
  <ul>
    <li><strong>Account info:</strong> email, full name, avatar, phone (optional).</li>
    <li><strong>Profile info you choose to share:</strong> address, date of birth, family details, spiritual milestones (baptism, salvation date), engagement preferences (skills, interests, t-shirt size, dietary restrictions). Every field is optional.</li>
    <li><strong>Content you create:</strong> posts, comments, prayer requests, chat messages, event RSVPs, donations, group memberships.</li>
    <li><strong>Usage data:</strong> login timestamps, device tokens for push notifications, last-active timestamp.</li>
    <li><strong>Payment data:</strong> processed by Stripe — we never see your card number. We retain the transaction ID and amount for tax/accounting purposes.</li>
  </ul>

  <h2>2. How we use it</h2>
  <ul>
    <li>To run the app — show you the right content, deliver notifications, process donations.</li>
    <li>To let your church's admins manage their community (member directory, RSVPs, attendance).</li>
    <li>To comply with legal obligations (donation receipts, tax records).</li>
  </ul>

  <h2>3. Who sees your data</h2>
  <ul>
    <li>Other members of churches you've joined, scoped to what each surface exposes (e.g. your post author card vs. your full profile).</li>
    <li>Admins/pastors of your church, who can see your full profile via the admin profile view.</li>
    <li>Service providers we rely on: Supabase (database + auth), Stripe (payments), Expo (push notifications), Render (hosting). They process data on our behalf under their own privacy terms.</li>
    <li>We do not sell your personal information.</li>
  </ul>

  <h2>4. Your rights</h2>
  <p>You can:</p>
  <ul>
    <li><strong>Access</strong> your data — <code>GET /api/users/me/export</code> returns a JSON dump of everything we have about you.</li>
    <li><strong>Delete</strong> your account and all associated data — in the app: Settings → Account → Delete Account. Or visit <a href="/api/legal/account-deletion">our account-deletion page</a> if you can no longer access the app.</li>
    <li><strong>Correct</strong> your profile — edit any field in the profile section editor.</li>
    <li><strong>Block</strong> abusive users and <strong>report</strong> objectionable content via the in-app safety menu.</li>
    <li><strong>Opt out of notifications</strong> in Settings → Notifications.</li>
  </ul>

  <h2>5. Data retention</h2>
  <p>We keep your data for as long as you have an account. When you delete your account, we permanently delete your profile, posts, comments, chat messages, and other personal content within 30 days. Financial records (donations) are retained in anonymized form for tax/legal compliance.</p>

  <h2>6. Children</h2>
  <p>The app is not directed at children under 13. We do not knowingly collect data from children under 13 without parental consent. Church check-in records of minors are managed by their parents/guardians and church staff under each church's own policies.</p>

  <h2>7. Changes</h2>
  <p>We'll update this page when we change how we handle data. The "last updated" date at the top reflects the latest revision.</p>

  <h2>8. Contact</h2>
  <p>Questions or concerns: <a href="mailto:privacy@shepardapp.com">privacy@shepardapp.com</a></p>
</body>
</html>`;
