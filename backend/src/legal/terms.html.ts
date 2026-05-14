// Public terms-of-service page. Served at GET /api/legal/terms.

export const TERMS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service — Shepard</title>
  <style>
    body { margin: 0; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2933; max-width: 760px; margin-inline: auto; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    h2 { font-size: 20px; margin-top: 32px; }
    p, li { font-size: 16px; }
    a { color: #2563eb; }
    .updated { color: #64748b; font-size: 14px; margin-bottom: 24px; }
  </style>
</head>
<body>
  <h1>Terms of Service</h1>
  <p class="updated">Last updated: May 14, 2026</p>

  <p>By using Shepard you agree to these terms. If you don't agree, please don't use the app.</p>

  <h2>1. Eligibility</h2>
  <p>You must be 13 or older. If you're between 13 and 18, your parent or guardian must accept these terms on your behalf.</p>

  <h2>2. Your account</h2>
  <p>You're responsible for keeping your login credentials secure and for any activity on your account. Notify us immediately at <a href="mailto:support@shepardapp.com">support@shepardapp.com</a> if you suspect unauthorized access.</p>

  <h2>3. Acceptable use</h2>
  <p>You agree not to:</p>
  <ul>
    <li>Post or share content that is illegal, threatening, harassing, hateful, sexually explicit, or that infringes someone else's rights.</li>
    <li>Impersonate others or misrepresent your affiliation with any person or church.</li>
    <li>Attempt to access data you're not authorized to see, or interfere with the app's security or operation.</li>
    <li>Use the app to send spam or unsolicited bulk communications.</li>
  </ul>
  <p>We can remove content and suspend accounts that violate these rules. We respond to user reports within a reasonable timeframe.</p>

  <h2>4. Your content</h2>
  <p>You keep ownership of what you post. By posting, you grant us a non-exclusive license to host and display your content within the app so other members of your church can see it. You can delete your content at any time.</p>

  <h2>5. Donations</h2>
  <p>Donations are processed by Stripe. Once submitted, donations are typically non-refundable. Contact your church's administrator for refund requests. Tax receipts are issued by each church directly.</p>

  <h2>6. Subscriptions (churches only)</h2>
  <p>If your church subscribes to a paid tier, the church (not individual members) is the billing party. Subscriptions auto-renew until cancelled. The church administrator can cancel at any time in the church settings.</p>

  <h2>7. Disclaimers</h2>
  <p>The app is provided "as is" without warranty of any kind. We don't guarantee uninterrupted availability or that the app will be error-free.</p>

  <h2>8. Limitation of liability</h2>
  <p>To the maximum extent permitted by law, we are not liable for indirect, incidental, or consequential damages arising from your use of the app.</p>

  <h2>9. Changes</h2>
  <p>We may update these terms. If we make material changes, we'll notify you in-app and/or by email. Your continued use after changes constitutes acceptance.</p>

  <h2>10. Contact</h2>
  <p>Questions: <a href="mailto:support@shepardapp.com">support@shepardapp.com</a></p>
</body>
</html>`;
