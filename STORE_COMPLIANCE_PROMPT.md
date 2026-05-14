# App Store + Play Store Compliance — Mobile Handoff

Everything below is what the mobile app needs to ship before Apple App Store Review and Google Play Console will accept the build. Backend pieces are already done (see "Backend status" sections under each item) — this list is the **mobile-side** punch list, organized by store requirement.

---

## 1. Privacy permission prompts (iOS)

Every privacy-sensitive API needs a usage-description string in `Info.plist`. Apple rejects builds that touch these APIs without the string. The system **only shows the permission prompt once** — if denied, the user has to enable it manually in iOS Settings.

Add to `app.json` / `app.config.ts` under `ios.infoPlist`:

```jsonc
{
  "ios": {
    "infoPlist": {
      "NSCameraUsageDescription": "Shepard uses the camera to let you take photos for posts, profile pictures, and event stories.",
      "NSPhotoLibraryUsageDescription": "Shepard reads your photo library so you can upload images to posts, profile pictures, and comments.",
      "NSPhotoLibraryAddUsageDescription": "Shepard saves images you download from the app (sermons, event flyers) to your photo library.",
      "NSMicrophoneUsageDescription": "Shepard uses the microphone when you record video for stories or voice notes in chat.",
      "NSLocationWhenInUseUsageDescription": "Shepard uses your location to suggest nearby churches and verify check-in at services.",
      "NSContactsUsageDescription": "Shepard can match contacts on your phone to existing church members so you can invite them more easily.",
      "NSFaceIDUsageDescription": "Shepard uses Face ID to keep your account secure when you reopen the app.",
      "NSUserTrackingUsageDescription": "Shepard does not track you across other companies' apps."
    }
  }
}
```

**Critical rules:**
- Request permission **at the point of use**, never on app launch. Apple rejects "preemptive" permission requests.
- Show a custom "rationale" sheet **before** the system prompt — explain why you need it. Once the user says no to the system prompt, you can't ask again.
- If a permission was denied, surface a "Open Settings" button that deep-links to iOS Settings.
- For **push notifications**, do **not** prompt on first launch. Wait until the user has done something that earns notifications (RSVPed to an event, joined a group, posted a comment). Same point-of-use rule.

---

## 2. Privacy permission prompts (Android)

Add to `app.json` under `android.permissions`:

```jsonc
{
  "android": {
    "permissions": [
      "CAMERA",
      "READ_MEDIA_IMAGES",
      "READ_MEDIA_VIDEO",
      "RECORD_AUDIO",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_FINE_LOCATION",
      "POST_NOTIFICATIONS",
      "READ_CONTACTS"
    ]
  }
}
```

**Critical rules:**
- **POST_NOTIFICATIONS** is required on Android 13+ (API 33). Request it at runtime, point-of-use.
- Target Android API 34 (or 35 once it's mandatory — Play deadline is August 31, 2026). Check `expo-build-properties`.
- Don't request permissions you don't actually use. Play flags unused-but-declared permissions in the Data Safety form review.

---

## 3. Account deletion (App Store 5.1.1(v) + Play 2023 requirement)

### Backend status: DONE

- **In-app deletion endpoint:** `DELETE /api/users/me` — permanently removes account, posts, comments, chat messages, prayer requests, group memberships, follows, push tokens, and S3 objects. Donations are retained in anonymized form for tax/legal compliance.
- **Web-accessible deletion page:** `https://<api-host>/api/legal/account-deletion` — public HTML, no sign-in required. **This URL is what you register on the Play Console "Data deletion URL" field.**

### Mobile work:

- Settings → Account → **Delete Account** button (Apple requires the deletion path be *initiated within the app*).
- Show a confirmation sheet that lists what will be deleted vs. what's kept (donations). Require the user to type "DELETE" or hold a long-press button — protect against fat-fingers.
- After successful `DELETE /api/users/me` (200 response): sign the user out, clear all local state (SecureStore, AsyncStorage, Realm/SQLite), and navigate to the unauthenticated welcome screen.
- 401 fallback: token already expired — they're effectively signed out; still wipe local state.

---

## 4. Data export (GDPR Article 15 / CCPA "Right to Know")

### Backend status: DONE

- **Endpoint:** `GET /api/users/me/export` — returns a complete JSON dump of every table that references the user:
  - `profile` (every extended profile field — see [Section 7](#7-extended-profile-fields))
  - `posts`, `comments`, `chatMessages`, `stories`
  - `transactions` (donation history)
  - `memberships` (tenants you've joined)
  - `follows.{following, followers}`
  - `prayers`, `eventRsvps`, `groupMemberships`, `familyRelationships`, `tags`
  - `notificationSettings`, `blockedUsers`, `reportsFiled`
  - `likes`, `saves`

### Mobile work:

- Settings → Privacy → **Export My Data** button.
- On tap: call `GET /api/users/me/export`, save the JSON to a file (`shepard-data-${userId}-${date}.json`), and present the iOS/Android share sheet so the user can save it to Files / Drive / email it to themselves.
- Show a "this may take a moment" loading state — the query fans out over ~18 tables.

---

## 5. UGC moderation — block + report (App Store 1.2 + Play UGC policy)

Both stores require **every** social app with user-generated content to provide:

1. A way to filter objectionable content (we have admin archive / delete — done backend-side).
2. A way for users to **flag/report** individual posts, comments, messages, users.
3. A way for users to **block abusive users** (their content disappears from the blocker's feed).
4. Developer must act on reports in a "timely manner" (next-day human review or auto-hide on threshold).

### Backend status: DONE

- **Report content:** `POST /api/safety/report` — body: `{ contentId, contentType: 'post'|'comment'|'user'|'message', reason }`. Throttled to 10/min/user.
- **Block user:** `POST /api/safety/block/:userId` — silently dedupes.
- **Unblock:** `DELETE /api/safety/block/:userId`.
- **List blocked:** `GET /api/safety/blocked`.
- **Feed filtering:** Posts feed, comments, and follower/following lists now exclude blocked users (in both directions — if A blocks B, neither sees the other's content). Live.

### Mobile work:

- **Three-dot menu** on every post, comment, chat message, and user profile with these options:
  - **Report** → opens a sheet with reason categories (Spam, Harassment, Hate, Explicit, Violence, Self-harm, Misinformation, Other) → `POST /api/safety/report`.
  - **Block user** → confirmation dialog → `POST /api/safety/block/:userId`. Show toast "@name blocked. You won't see their content."
- Settings → Privacy → **Blocked Users** list → `GET /api/safety/blocked` → "Unblock" button per row.
- After block: optimistically remove the blocked user's content from the current screen so the user sees the block take effect immediately.

---

## 6. Push notification opt-in flow

### Mobile work:

- **Do not** request notification permission on first launch — both stores penalize this as "preemptive."
- Wait for a meaningful first interaction: posting their first comment, RSVPing to an event, joining a group, or opening Settings → Notifications.
- Show a **rationale screen** first: "Want to be notified when someone comments on your post or invites you to a group? Tap Allow on the next prompt."
- Then call `Notifications.requestPermissionsAsync()` (Expo).
- If granted: register Expo Push Token → `POST /api/notifications/device-tokens` (already wired).
- If denied: show a one-line note in Settings → Notifications: "Push is off — enable in your phone's Settings."

---

## 7. Extended profile fields

Migration 067 added 30 optional profile fields. Mobile should expose these in the profile section editor (already requested) and pre-fill from `GET /api/users/me`:

- Contact: `phone`, `phoneSecondary`, `address`, `preferredContactMethod`
- Personal: `dateOfBirth`, `occupation`, `employer`, `maritalStatus`, `anniversary`, `spouseName`, `hasChildren`, `children`, `emergencyContact`
- Church/spiritual: `membershipStatus`, `memberSince`, `baptized`, `baptismDate`, `baptismLocation`, `salvationDate`, `previousChurch`, `howDidYouHear`
- Engagement: `serviceInterests`, `skills`, `languages`, `tshirtSize`, `dietaryRestrictions`
- Consent: `newsletterOptIn`, `smsOptIn`, `photoReleaseConsent`
- Visibility: `birthdayVisible`, `anniversaryVisible`

Privacy: never render `address`, `phone`, `phoneSecondary`, `dateOfBirth`, `children`, `emergencyContact`, or `dietaryRestrictions` in any public-facing surface (post author cards, follower lists, public profiles). They only flow through `GET /api/users/me` and the admin profile-extras endpoint.

---

## 8. Sign in with Apple (conditional)

**Required if** the app offers any third-party social login (Google, Facebook, etc.). If we only support email/password via Supabase, this is **not required**.

If/when we add Google sign-in: simultaneously add Sign in with Apple as a peer option on iOS.

---

## 9. App Store + Play Store console submissions

### Apple App Store Connect:
- **Privacy Policy URL:** `https://<api-host>/api/legal/privacy-policy`
- **Privacy Nutrition Labels:** Declare:
  - Contact Info (name, email, phone) — linked to identity, used for App Functionality
  - Health & Fitness (none unless we add fitness features)
  - Financial Info — NOT linked to identity (Stripe handles payment data; we only see anonymous transaction IDs)
  - Location — Optional, used for Church Discovery
  - Sensitive Info (religious affiliation, health/dietary info) — Linked to identity, used for App Functionality
  - User Content (photos, posts, messages) — Linked to identity, used for App Functionality
  - Identifiers (user ID, device ID) — Linked to identity, used for App Functionality
  - Diagnostics — Not linked to identity (crash reports)
- **Sign in with Apple:** N/A if email-only.
- **App Tracking Transparency:** We don't track across other companies' apps; the `NSUserTrackingUsageDescription` string above is purely informational.
- **Age rating:** 12+ (UGC + religious content). Set via the questionnaire.
- **Demo account:** Provide one. (`zeldred72@gmail.com` is fine for the demo tenant.)

### Google Play Console:
- **Privacy Policy URL:** `https://<api-host>/api/legal/privacy-policy`
- **Account Deletion URL:** `https://<api-host>/api/legal/account-deletion` (required field as of 2023).
- **Data Safety form:** Declare each data type, whether it's collected, shared, optional, used for app functionality vs. analytics. Mirror the iOS Privacy Nutrition Labels above.
- **Content rating:** Complete the IARC questionnaire — flag UGC and donations.
- **Target API level:** 34 minimum (Play deadline is 35 by August 2026).
- **Testers:** Add internal testers before public release.

---

## 10. Backend endpoints summary

Everything mobile needs to call:

| Concern | Endpoint | Auth |
|---|---|---|
| Account deletion | `DELETE /api/users/me` | JWT |
| Data export | `GET /api/users/me/export` | JWT |
| Block user | `POST /api/safety/block/:userId` | JWT |
| Unblock user | `DELETE /api/safety/block/:userId` | JWT |
| List blocked | `GET /api/safety/blocked` | JWT |
| Report content | `POST /api/safety/report` | JWT |
| Notification settings | `GET /api/users/me/settings`, `PUT /api/users/me/settings` | JWT |
| Privacy policy (web) | `GET /api/legal/privacy-policy` | none |
| Terms (web) | `GET /api/legal/terms` | none |
| Account deletion (web) | `GET /api/legal/account-deletion` | none |

---

## 11. UX checklist — Settings screen

The Settings screen needs these sections to satisfy both stores' reviewer checklists:

- **Account**
  - Edit Profile (PATCH `/api/users/me`)
  - Change Password (existing reset flow)
  - **Delete Account** (red, with confirmation)
- **Notifications**
  - Per-channel toggles (email, push, SMS, in-app) → PUT `/api/users/me/settings`
- **Privacy**
  - **Blocked Users** list (GET `/api/safety/blocked`)
  - **Export My Data** (GET `/api/users/me/export`)
  - Link to Privacy Policy → opens `https://<api-host>/api/legal/privacy-policy` in webview
- **Legal**
  - Terms of Service → `https://<api-host>/api/legal/terms`
  - Privacy Policy → `https://<api-host>/api/legal/privacy-policy`
  - Account Deletion Info → `https://<api-host>/api/legal/account-deletion`
- **Support**
  - Contact Us (mailto:support@shepardapp.com)
  - App version + build number

---

## 12. What's already done backend-side

- ✅ Account deletion API (`DELETE /api/users/me`) with full S3 + cascading SQL cleanup
- ✅ Expanded data export covering 18 tables (profile + UGC + relationships + safety logs)
- ✅ Block + unblock + list-blocked endpoints
- ✅ Content reporting endpoint (10/min throttle)
- ✅ Feed-level block filtering (posts, comments, follower/following lists exclude blocked users in both directions)
- ✅ Public privacy policy, terms, and account-deletion landing pages at `/api/legal/*`
- ✅ Push notification opt-in toggles (`GET/PUT /api/users/me/settings`)

## 13. What's NOT done (mobile responsibility)

- ❌ iOS Info.plist usage description strings
- ❌ Android permissions in app.json + runtime requests
- ❌ Point-of-use permission UX with rationale screens
- ❌ Settings → Account → Delete Account flow
- ❌ Settings → Privacy → Blocked Users + Export My Data screens
- ❌ Three-dot menus on posts/comments/chat for Report + Block
- ❌ Reason-category sheet for content reporting
- ❌ App Store Privacy Nutrition Labels submission
- ❌ Play Data Safety form submission
- ❌ Demo account + reviewer instructions

Tackling these in this order will get the app through review on the first submission:
1. Permissions (Info.plist + Android) — easy unblock
2. Settings → Delete Account + Export Data
3. Three-dot menus on UGC for Report + Block
4. Blocked Users list screen
5. Console submissions (privacy labels, data safety, deletion URL)
