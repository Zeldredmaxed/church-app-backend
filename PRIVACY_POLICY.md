# Privacy Policy

**Effective date:** April 11, 2026
**Last updated:** April 11, 2026

This Privacy Policy describes how Denzel Christopher Combs ("**we**," "**us**," or "**Shepard**"), a sole proprietorship operating out of Indiana, collects, uses, and shares personal information when you use the Shepard mobile application, website, and related services (the "**Service**").

If you do not agree with this policy, do not use the Service.

---

## 1. Who we are

Shepard is a church-community platform operated by Denzel Christopher Combs as a sole proprietorship.

**Contact for privacy requests:** support@shepard.love
**Mailing address:** 1701 Dr. Andrew J Brown Ave, Indianapolis, IN 46202

You can reach us about anything in this policy — including data access, correction, and deletion requests — at the email or address above.

---

## 2. Information we collect

### 2.1 Information you provide

When you create an account or use the Service, you may provide:

- **Account information:** full name, email address, password (handled by our authentication provider, Supabase; we never see plaintext passwords), optional phone number, profile photo.
- **Church / community information:** the church (tenant) you join, your role within it (member, pastor, admin, volunteer), and memberships in groups, small groups, or volunteer teams.
- **Content you create:** posts, comments, chat messages, direct messages, prayer requests, event RSVPs, story uploads, sermon interactions, and any media (photos, videos, audio) you attach to them.
- **Family information:** family relationships you add (e.g., spouse, parent, child) and the optional privacy setting you choose for each.
- **Child check-in information:** if you check a minor into a service as a guardian, we record the child's name, your guardian relationship, any medical/allergy notes you add, and an authorized-pickup list.
- **Giving and donation information:** donation amount, fund designation, and the payment method is handled by Stripe. Stripe provides us a transaction ID, amount, and status — we do not store full card numbers or bank account details. See Section 6.
- **Communications with us:** any message you send to support@shepard.love or via in-app feedback.

### 2.2 Information collected automatically

- **Device information:** device type, operating system version, language, time zone, and a push-notification token (if you enable push).
- **App activity:** screens viewed, features used, badges earned, check-in events, login streak, and similar engagement data used to power badge progression and in-app analytics.
- **Approximate and precise location:** if you enable location permissions for the check-in feature, we collect your GPS coordinates at the moment you check into a service to verify you are physically at the church. We do **not** track location in the background.
- **Log data:** IP address, request timestamps, HTTP error codes, and user-agent string. Used for security, abuse prevention, and debugging.

### 2.3 Information from third parties

- **Authentication provider (Supabase Auth):** receives your email and password for login; returns a session token.
- **Payment processor (Stripe):** receives your payment details directly; returns a transaction status and receipt URL. See Section 6.
- **Push notification providers (Expo Push Service, OneSignal):** receive your device's push token and message content for delivery.

---

## 3. How we use your information

We use the information we collect to:

- Provide, operate, and maintain the Service.
- Create and manage your account, assign you to your church community, and enforce role-based permissions.
- Deliver the features you request — posts, comments, chat, events, giving, prayer, check-in, family tree, badges, workflows, the AI assistant (Shepherd Assistant), and administrative tools for pastors and admins.
- Process donations and recurring giving via Stripe and send you a receipt.
- Send push notifications, emails, and SMS messages you have opted into (new messages, prayer requests, event reminders, donation receipts, family connection requests).
- Verify check-in location to prevent fraudulent attendance records.
- Detect, investigate, and prevent fraud, abuse, spam, harassment, and security incidents.
- Enforce our Terms of Service and other policies.
- Comply with legal obligations.
- Communicate with you about service announcements, security updates, and (with your separate consent) product news.

We do **not** sell your personal information. We do **not** use your data to train third-party AI models, and we do **not** use your data for targeted advertising.

### 3.1 AI Assistant (Shepherd Assistant)

If your church subscribes to the Premium or Enterprise tier and an authorized user (typically a pastor or admin) uses the Shepherd Assistant feature, their natural-language queries are sent to Anthropic (our AI provider) to generate SQL queries. The Assistant runs those queries only against your own church's data — it cannot access other churches' data. Anthropic does not retain these queries to train its models. Pastoral members of the public are **not** the users of this feature; only admins/pastors can access it.

---

## 4. How we share your information

We share information in the following limited circumstances:

### 4.1 Within your church

Your church is a multi-tenant community. Information you share within your church (posts, comments, prayers, your name, profile photo, badges, family relationships marked public, giving totals for admins/pastors) is visible to other members of your church according to the privacy controls you set and the role-based permissions of the viewer.

### 4.2 Service providers

We share data with vendors who process it on our behalf under a contract:

- **Supabase** — database hosting, authentication (data: account information, all app content)
- **Stripe** — payment processing (data: payment method, donation amount, email, name)
- **Render** — backend hosting (data: all app data in transit)
- **Upstash / Redis** — caching and queue infrastructure (data: transient cache + queue payloads)
- **AWS S3** — media storage (data: photos, videos, audio uploads)
- **Expo (Expo Push Service)** — push notification delivery (data: push token, notification content)
- **OneSignal** — push notification delivery (legacy; data: push token, notification content)
- **Anthropic** — AI Assistant query processing, Premium/Enterprise only (data: natural-language query text from pastors/admins)
- **Resend** — transactional email delivery (data: email address, email content)
- **Twilio** — SMS delivery for opted-in users (data: phone number, SMS content)
- **Mux** — video hosting and playback (data: video files, playback events)

### 4.3 Legal requirements

We may disclose information when we believe in good faith it is required to comply with a law, regulation, subpoena, court order, or other lawful government request; to enforce our Terms; to protect the safety of any person; or to detect, prevent, or address fraud, security, or technical issues.

### 4.4 Business transfers

If Shepard is acquired, merged, or sells substantially all of its assets, your information may be transferred to the acquiring entity, subject to this Privacy Policy or a successor policy we will notify you of.

### 4.5 With your consent

We may share information in other ways if you give us permission.

---

## 5. Your rights and choices

Depending on where you live, you have the following rights:

- **Access:** request a copy of the personal information we hold about you.
- **Correction:** ask us to correct inaccurate data.
- **Deletion:** delete your account and associated data from within the app (Settings → Delete Account) or by emailing support@shepard.love. When you delete your account, we remove your profile, posts, comments, prayers, messages, and family connections. We retain donation records as required by tax and financial recordkeeping laws (typically 7 years in the US). We may also retain information required to comply with legal obligations or resolve disputes.
- **Portability:** request your data in a structured, machine-readable format.
- **Opt-out of push/email/SMS:** adjust notification preferences in Settings or use the unsubscribe link in emails.
- **Do not sell / Do not share:** we do not sell or share your personal information for targeted advertising. No action is required.

If you are in the EU/EEA/UK, you have GDPR rights including objection to processing and lodging a complaint with a data protection authority. If you are in California, you have CCPA/CPRA rights including the right to know, delete, correct, and opt out of sale/sharing.

To exercise any right, email **support@shepard.love** with your account email. We will respond within the timelines required by applicable law (typically 30–45 days).

---

## 6. Payments (Stripe)

Donations and subscription fees are processed by Stripe, Inc. When you make a payment, your card or bank details are sent directly to Stripe; we never receive or store them. Stripe provides us with a transaction ID, amount, currency, status, and (if you include it) the fund designation.

Donations processed through Shepard are exempt from Apple's In-App Purchase requirement because they are voluntary contributions to registered 501(c)(3) nonprofits (churches).

For Stripe's privacy practices see: https://stripe.com/privacy

---

## 7. Children's privacy

Shepard is intended for users age 13 and older. If you are a parent or guardian, you may use the child check-in feature to record your minor child's attendance and guardian relationship. This information is visible only to your church's designated check-in staff (admins, pastors, volunteers). We do **not** knowingly collect personal information directly from children under 13.

If we learn that we have collected personal information from a child under 13 without verified parental consent, we will delete it promptly. To report such collection, email **support@shepard.love**.

---

## 8. Data security

We use industry-standard measures to protect your data:

- All traffic is encrypted in transit via HTTPS/TLS.
- Passwords are never stored — authentication is delegated to Supabase, which hashes passwords using bcrypt.
- Every database query is tenant-isolated via PostgreSQL Row-Level Security, so churches cannot read each other's data even in the event of an application bug.
- Payment data is handled exclusively by Stripe (PCI-DSS Level 1 compliant).
- We log and monitor for unauthorized access and respond promptly to security incidents.

No system is perfectly secure. If we discover a breach affecting your personal information, we will notify you without undue delay as required by applicable law.

---

## 9. Data retention

We retain your personal information for as long as your account is active or as needed to provide the Service. After deletion:

- Profile, posts, comments, prayers, and messages: removed within 30 days.
- Donation records: retained for up to 7 years to comply with tax and financial regulations.
- Backups: purged on our normal backup rotation (up to 90 days).
- Aggregated or de-identified analytics data that cannot reasonably re-identify you: may be retained indefinitely.

---

## 10. International users

Shepard is operated from the United States. If you access the Service from outside the US, your information will be transferred to, stored, and processed in the US. By using Shepard, you consent to this transfer.

---

## 11. Changes to this policy

We may update this Privacy Policy from time to time. If we make material changes, we will notify you via in-app notice or email at least 14 days before the change takes effect. The "Last updated" date at the top reflects the most recent revision.

---

## 12. Contact us

Privacy questions, data requests, or legal notices:

**Email:** support@shepard.love
**Mail:** Denzel Christopher Combs, 1701 Dr. Andrew J Brown Ave, Indianapolis, IN 46202
