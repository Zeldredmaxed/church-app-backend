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
    h3 { font-size: 17px; margin-top: 20px; margin-bottom: 6px; }
    p, li { font-size: 16px; }
    a { color: #2563eb; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
    .updated { color: #64748b; font-size: 14px; margin-bottom: 24px; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; font-size: 15px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    th { background: #f8fafc; }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p class="updated">Last updated: June 6, 2026</p>

  <p>Shepard ("we," "our," "us") provides software for churches to manage their communities. This policy explains what data we collect, why, and how to control it. Shepard is operated by Denzel Christopher Combs, a sole proprietorship organized in the State of Indiana, USA.</p>

  <h2>1. Information we collect</h2>
  <ul>
    <li><strong>Account info:</strong> email, full name, avatar, phone (optional).</li>
    <li><strong>Profile info you choose to share:</strong> address, date of birth, family details, spiritual milestones (baptism, salvation date), engagement preferences (skills, interests, t-shirt size, dietary restrictions). Every field is optional.</li>
    <li><strong>Content you create:</strong> posts, comments, prayer requests, chat messages, event RSVPs, donations, group memberships.</li>
    <li><strong>Usage data:</strong> login timestamps, device tokens for push notifications, last-active timestamp.</li>
    <li><strong>Payment data:</strong> processed by Stripe — we never see your card number. We retain the transaction ID and amount for tax/accounting purposes.</li>
    <li><strong>Children's profiles created by guardians:</strong> see Section 7 below.</li>
  </ul>

  <h3>1a. Auto-attendance location data (opt-in)</h3>
  <p>If your church enables auto-attendance and you opt in, the Shepard app will periodically read your device's GPS location <strong>only during pre-defined service windows</strong> set by your church administrator (for example, "Sunday 9:30 AM – 11:30 AM"). We also use a <strong>30-minute buffer</strong> before and after each scheduled window to capture early arrivals and late departures, after which background location collection automatically stops.</p>
  <p>This feature is strictly <strong>opt-in</strong>: it is off by default and the app will not collect background location data unless you explicitly enable auto-attendance in Settings → Privacy → Auto-Attendance. You can <strong>opt out at any time</strong> by toggling the setting off, by revoking location permission in your device's OS settings, or by uninstalling the app. After opting out, no further location pings are collected, and the app's background-location capability is fully disabled on your device. Previously collected raw pings are deleted within the retention window described in Section 8.</p>

  <h2>2. How we use it</h2>
  <ul>
    <li>To run the app — show you the right content, deliver notifications, process donations.</li>
    <li>To let your church's admins manage their community (member directory, RSVPs, attendance).</li>
    <li>To comply with legal obligations (donation receipts, tax records).</li>
    <li><strong>Auto-attendance location data</strong> is used solely to mark your attendance at a service when your device is inside the geofence of a campus you belong to, during the scheduled service window (plus the 30-minute buffer). Raw GPS coordinates are never displayed to other members and are never used for advertising, profiling outside attendance, or any purpose unrelated to attendance marking.</li>
  </ul>

  <h2>3. Who sees your data</h2>
  <ul>
    <li>Other members of churches you've joined, scoped to what each surface exposes (e.g. your post author card vs. your full profile).</li>
    <li>Admins/pastors of your church, who can see your full profile via the admin profile view.</li>
    <li>Service providers (sub-processors) we rely on, listed below.</li>
    <li>We do <strong>not</strong> sell your personal information, and we do not "share" it for cross-context behavioral advertising as defined under the CCPA.</li>
  </ul>

  <h3>3a. Sub-processors</h3>
  <p>We rely on the following service providers, each of which processes data on our behalf under their own privacy and security terms:</p>
  <ul>
    <li><strong>Supabase</strong> — database (PostgreSQL) and authentication.</li>
    <li><strong>Stripe</strong> — payment processing for donations and church subscriptions.</li>
    <li><strong>Render</strong> — backend application hosting.</li>
    <li><strong>AWS S3</strong> — object storage for uploaded images and files.</li>
    <li><strong>Expo Push Service</strong> — delivery of push notifications to your device.</li>
    <li><strong>Mux</strong> — video upload, transcoding, and playback.</li>
    <li><strong>Anthropic</strong> — AI assistant features (see Section 3b).</li>
    <li><strong>OpenAI</strong> — voice transcription via the Whisper API (see Section 3c).</li>
    <li><strong>Resend</strong> — transactional email delivery.</li>
    <li><strong>Twilio</strong> — SMS delivery for verification and notifications.</li>
  </ul>

  <h3>3b. AI assistant (Anthropic)</h3>
  <p>Certain optional features (such as the in-app AI assistant, sermon summarization, and admin productivity tools) send prompt content to <strong>Anthropic, PBC</strong> for processing by its Claude large language models. Anthropic acts as our sub-processor and is contractually prohibited from training its models on inputs or outputs originating from the Shepard service, per Anthropic's <a href="https://www.anthropic.com/legal/commercial-terms">Commercial Terms of Service</a>. Inputs may include the text of messages or documents you explicitly submit to an AI feature; they do not include unrelated personal data.</p>

  <h3>3c. Voice transcription (OpenAI Whisper)</h3>
  <p>When you use the in-app voice-to-text feature inside the AI assistant, the audio you record is sent to <strong>OpenAI, L.L.C.</strong> for transcription via the Whisper API. Per OpenAI's <a href="https://openai.com/policies/api-data-usage-policies">API data usage policies</a>, content submitted through the API is <strong>not used to train OpenAI's models</strong> and is retained for up to <strong>30 days</strong> for abuse-monitoring purposes before being deleted. OpenAI acts as our sub-processor for this feature. Audio is sent only when you explicitly tap the microphone in the AI assistant — no background or always-listening capture occurs.</p>

  <h3>3d. AI conversation retention</h3>
  <p>Conversations with the in-app AI assistant are stored on our servers so you can revisit prior threads. We delete inactive AI conversations <strong>90 days after the last message</strong>; the timer resets every time you send or receive a new message in the conversation. You may delete any AI conversation immediately from within the app.</p>

  <h2>4. Your rights</h2>
  <p>Depending on your jurisdiction, you may have the following rights with respect to your personal data. Shepard honors these rights for all users worldwide, regardless of residency.</p>
  <ul>
    <li><strong>Right of access</strong> (GDPR Art. 15 / CCPA right to know) — obtain a copy of the personal data we hold about you.</li>
    <li><strong>Right to rectification</strong> (GDPR Art. 16 / CCPA right to correct) — edit any field in the profile section editor, or contact us for fields you cannot self-serve.</li>
    <li><strong>Right to erasure / "right to be forgotten"</strong> (GDPR Art. 17 / CCPA right to delete) — delete your account and associated personal data; see Section 5 below and our <a href="/api/legal/account-deletion">account-deletion page</a>.</li>
    <li><strong>Right to restriction of processing</strong> (GDPR Art. 18) — request that we limit how we process your data while a dispute is resolved.</li>
    <li><strong>Right to data portability</strong> (GDPR Art. 20 / CCPA right to portability) — receive your data in a structured, machine-readable JSON format; see Section 5 below.</li>
    <li><strong>Right to object</strong> (GDPR Art. 21) — object to processing based on legitimate interests, including for direct marketing.</li>
    <li><strong>Rights related to automated decision-making</strong> (GDPR Art. 22) — we do not subject you to legal or similarly significant decisions based solely on automated processing.</li>
    <li><strong>Right to non-discrimination</strong> (CCPA) — we will not deny service, charge different prices, or provide a different quality of service for exercising your privacy rights.</li>
    <li><strong>Right to lodge a complaint</strong> with your local supervisory authority (GDPR Art. 77) — EU/EEA residents may complain to their national data-protection authority; UK residents to the ICO.</li>
    <li>You may also <strong>block</strong> abusive users and <strong>report</strong> objectionable content via the in-app safety menu, and <strong>opt out of notifications</strong> in Settings → Notifications.</li>
  </ul>

  <h2>5. Exporting and deleting your data</h2>
  <p>To export a copy of your personal data, open the app and go to <strong>Settings → Account → Export My Data</strong>. We will prepare a downloadable JSON archive of all personal data we hold about you and deliver it within <strong>30 days</strong> of your request, typically much sooner. To prevent abuse, exports are rate-limited to a maximum of <strong>5 export requests per day per account</strong>.</p>
  <p>To delete your account, go to <strong>Settings → Account → Delete Account</strong>, or visit our <a href="/api/legal/account-deletion">account-deletion page</a> if you can no longer access the app.</p>

  <h2>6. International data transfers</h2>
  <p>Shepard's servers and primary sub-processors store and process personal data in the <strong>United States of America</strong>. If you access the service from outside the United States — including from the European Economic Area, the United Kingdom, or Switzerland — your personal data will be transferred to and processed in the United States, which may not provide the same level of data-protection law as your home jurisdiction. As required by GDPR Article 13(1)(f), we inform you that we rely on the European Commission's <strong>Standard Contractual Clauses (SCCs)</strong> (Commission Implementing Decision (EU) 2021/914) with our sub-processors, together with supplementary technical and organizational measures (encryption in transit and at rest, access controls, least-privilege roles), as the lawful mechanism for these transfers. A copy of the relevant clauses is available on request from <a href="mailto:privacy@shepard.love">privacy@shepard.love</a>.</p>

  <h2>7. Children's data</h2>
  <p><strong>Children under 13 cannot create or hold Shepard accounts.</strong> We do not knowingly create accounts for, collect personal information from, or direct the service to children under 13.</p>
  <p>However, a parent or legal guardian with their own Shepard account may add <strong>child profiles</strong> for their minor children for the purpose of church check-in, kids' ministry administration, and family management. A child profile may include:</p>
  <ul>
    <li>The child's name (and optional preferred name)</li>
    <li>Relationship to the guardian</li>
    <li>Allergies and medical notes (e.g. "peanut allergy," "asthma inhaler in backpack")</li>
    <li>A list of authorized pickup persons</li>
  </ul>
  <p>Allergy and medical information constitutes a <strong>special category of personal data</strong> under GDPR Article 9 and analogous "sensitive personal information" categories under the CCPA. We process this data <strong>only</strong> with the guardian's explicit consent, for the limited purpose of safe child check-in and kids' ministry care, and we apply heightened access controls (visible only to the child's guardians and to authorized check-in staff of the church the child is associated with).</p>
  <p>With respect to children's data and other church-member data, Shepard acts as a <strong>data processor on behalf of the church</strong> (the data controller). The church is responsible for obtaining and documenting any guardian consents required under COPPA, GDPR, or local law before adding a child profile. A guardian may delete a child profile at any time from the family management screen.</p>

  <h2>8. Data retention</h2>
  <p>We retain personal data only as long as necessary for the purpose it was collected. Specific retention periods:</p>
  <table>
    <thead>
      <tr><th>Data category</th><th>Retention period</th></tr>
    </thead>
    <tbody>
      <tr><td>Server access and application logs</td><td>90 days, then automatically purged</td></tr>
      <tr><td>Database backups</td><td>30 days, then automatically purged</td></tr>
      <tr><td>Push notification device tokens</td><td>Deleted on logout or token invalidation</td></tr>
      <tr><td>Auto-attendance raw location pings (lat/lng)</td><td>90 days, then permanently deleted</td></tr>
      <tr><td>AI assistant conversations</td><td>90 days from the last message; resets on activity. Deleted immediately if you remove the conversation in-app.</td></tr>
      <tr><td>Voice transcription audio (OpenAI Whisper)</td><td>Up to 30 days at OpenAI for abuse-monitoring, then deleted by OpenAI. We do not retain the audio after the transcription completes.</td></tr>
      <tr><td>Aggregated service-attendance records (anonymized)</td><td>7 years, in anonymized form, for church historical reporting</td></tr>
      <tr><td>Donation records</td><td>7 years (US IRS recordkeeping requirement); donor identity may be anonymized after account deletion while preserving amount, date, and church</td></tr>
      <tr><td>All other personal data on account deletion</td><td>Permanently deleted within 30 days of the deletion request</td></tr>
    </tbody>
  </table>

  <h2>9. Changes</h2>
  <p>We'll update this page when we change how we handle data. The "last updated" date at the top reflects the latest revision.</p>

  <h2>10. Contact</h2>
  <p>Questions or concerns: <a href="mailto:privacy@shepard.love">privacy@shepard.love</a></p>
</body>
</html>`;
