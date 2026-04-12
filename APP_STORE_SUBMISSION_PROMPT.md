# App Store Submission Checklist — Apple App Store & Google Play

> **Date:** April 11, 2026
> **From:** Backend Team
> **For:** Admin Dashboard (Next.js) + Mobile App (React Native / Expo)
> **Purpose:** Ensure we pass both Apple and Google review on first submission

---

## Critical Context

Both Apple and Google reject ~15% of submissions. The most common rejection reasons are: missing privacy policy, crashes on launch, missing account deletion, unclear permissions, and incomplete metadata. This checklist covers every requirement. Items marked with a backend status show what's already built vs what's needed.

---

## 1. Legal Documents (REQUIRED by both stores)

### Privacy Policy
- [ ] **Hosted URL** — Must be a publicly accessible URL (not behind auth)
  - Suggested: `https://shepard.love/privacy` or a hosted page on your marketing site
  - Must disclose: what data is collected, how it's used, who it's shared with, how to delete data
  - Must cover: Supabase (auth), Stripe (payments), Expo (push notifications), S3 (media storage)
  - **Backend status:** No privacy policy endpoint exists. Need a static page or URL.

### Terms of Service
- [ ] **Hosted URL** — Same as above, publicly accessible
  - Suggested: `https://shepard.love/terms`
  - **Backend status:** No terms endpoint exists. Need a static page or URL.

### Where These Must Appear
- [ ] In the app (Settings screen — link to both)
- [ ] In App Store Connect metadata (Privacy Policy URL field)
- [ ] In Google Play Console (Privacy Policy URL field)
- [ ] In Google Play Data Safety form (linked)

---

## 2. Account Deletion (REQUIRED by Apple since June 2022)

Apple **will reject** any app that supports account creation but does not allow users to delete their account from within the app.

### Requirements
- [ ] "Delete Account" button in app Settings screen
- [ ] Must initiate deletion from within the app (NOT "email us to delete")
- [ ] Must clearly explain what data will be deleted
- [ ] Must actually delete: auth account, profile data, posts, comments, transactions (or anonymize)
- [ ] Confirmation dialog before deletion ("Are you sure? This cannot be undone.")

### Backend Status: **BUILT**
- `DELETE /api/users/me` endpoint exists in `users.controller.ts`
- Deletes from `auth.users` via Supabase Admin SDK
- Cascades to `public.users` (FK ON DELETE CASCADE)
- **Mobile team action:** Add a "Delete Account" button in Settings → calls `DELETE /api/users/me`

---

## 3. Push Notification Permissions (REQUIRED by both stores)

### Apple Requirements
- [ ] Must request push permission with a **pre-prompt** explaining WHY
  - Show a custom modal BEFORE the iOS system dialog: "Shepard sends notifications for new messages, prayer updates, and event reminders. Would you like to enable notifications?"
  - User taps "Enable" → then show the system permission dialog
  - If user declines, the app must still function normally
- [ ] Must not spam notifications or send marketing without consent

### Google Requirements
- [ ] POST_NOTIFICATIONS runtime permission (Android 13+)
- [ ] Must explain what notifications the user will receive

### Backend Status: **BUILT**
- `POST /api/notifications/register-device` — registers Expo push token
- `DELETE /api/notifications/unregister-device` — removes on logout
- `GET /api/notifications/preferences` — per-type toggles
- **Mobile team action:** Add pre-prompt modal before `requestPermissionsAsync()`

---

## 4. Data Safety / App Privacy Labels

### Apple — App Privacy Labels (App Store Connect)
You must declare EVERY data type your app collects:

| Data Type | Collected? | Linked to User? | Used for Tracking? |
|-----------|-----------|-----------------|-------------------|
| Email Address | Yes | Yes | No |
| Name | Yes | Yes | No |
| Phone Number | Yes (optional) | Yes | No |
| Physical Address | No | — | — |
| Payment Info | Yes (via Stripe) | Yes | No |
| Photos/Videos | Yes (media uploads) | Yes | No |
| Location (precise) | Yes (check-in geo) | Yes | No |
| User Content (posts, comments) | Yes | Yes | No |
| Contacts | No | — | — |
| Search History | No | — | — |
| Identifiers (device ID) | Yes (Expo push token) | Yes | No |
| Usage Data | Yes (app opens, engagement) | Yes | No |
| Diagnostics | Yes (crash reports via Expo) | No | No |

### Google — Data Safety Form (Play Console)
Same data types, declared in Google's format:

- [ ] Email: Collected, not shared with third parties (except Stripe for receipts)
- [ ] Name: Collected for profile display
- [ ] Phone: Optional, collected for SMS notifications
- [ ] Payment info: Collected by Stripe (declare Stripe as payment processor)
- [ ] Location: Collected for check-in geo-verification (precise location)
- [ ] Photos: Collected for profile pictures and post media
- [ ] Push token: Collected for notifications (Expo push service)
- [ ] App activity: Collected for badge progression and engagement tracking

### Data Deletion
- [ ] Both stores require: "Users can request data deletion" → Yes
- [ ] Method: In-app account deletion (`DELETE /api/users/me`)

---

## 5. Content Moderation (REQUIRED for user-generated content)

Apple and Google BOTH require moderation tools for apps with UGC (posts, comments, messages, photos):

### Requirements
- [ ] **Report button** on posts, comments, and user profiles
- [ ] **Block user** functionality
- [ ] **Content review** system for admins/pastors to review reported content
- [ ] Age-appropriate content enforcement

### Backend Status: **BUILT**
- `POST /api/moderation/report` — report a post
- `GET /api/moderation/reports` — admin view of reported content
- Post visibility controls (public/private)
- **Mobile team action:** Add "Report" and "Block" buttons on post menus, comment menus, and user profiles

---

## 6. Payments — Stripe vs In-App Purchase

### Critical Exemption for Church Donations
Church/charity donations are **exempt** from Apple's In-App Purchase requirement and Google Play billing. Both stores specifically exempt:
- Charitable donations to registered nonprofits
- Physical goods and services
- Real-world event tickets
- Person-to-person payments

**Shepard's giving system uses Stripe Connect** — this is correct and compliant because:
1. Donations go directly to the church's Stripe Connect account (not a digital good)
2. Churches are 501(c)(3) tax-exempt organizations
3. No "digital content" is unlocked by donating

### What to Declare in Store Submissions
- [ ] Apple: In the "In-App Purchases" section, select "No" — donations are not IAP
- [ ] Google: In monetization declarations, select "Physical goods/services/donations"
- [ ] Both: If asked "Does your app use a third-party payment processor?" → Yes (Stripe)

### Subscription Tiers (Standard/Premium/Enterprise)
If church subscription billing (the $29/$79/$199 monthly plans) is handled **outside the app** (via web dashboard, Stripe billing portal), it does NOT need IAP. If you offer plan upgrades **inside the mobile app**, you may need to use Apple/Google IAP for that specific flow.

**Recommendation:** Handle all subscription/plan management via the admin dashboard (web), NOT the mobile app. Keep the mobile app donation-only via Stripe.

---

## 7. Demo Account for Reviewers (REQUIRED by Apple)

Apple reviewers need to test your app. You MUST provide login credentials.

### What to Provide
- [ ] **Demo email:** `reviewer@shepard.love` (or similar)
- [ ] **Demo password:** A working password
- [ ] **Church/Tenant:** Pre-populated with sample data (the "New Birth Test" church works)
- [ ] **Notes to reviewer:** Explain the app is a church management platform with social feed, giving, events, prayer, and messaging features

### Backend Action Needed
- [ ] Create a permanent demo account in Supabase Auth
- [ ] Ensure the account has `member` role in the test church
- [ ] Pre-populate the test church with realistic sample data (already done — New Birth Test)
- [ ] Make sure the demo account can: browse feed, view events, see badges, open messages

### For Google
Google doesn't always require demo credentials, but provide them in the "App access" section of Play Console just in case.

---

## 8. App Metadata & Screenshots

### Apple App Store Connect
- [ ] **App Name:** Shepard (or "Shepard - Church Community")
- [ ] **Subtitle:** "Your Church. Connected." (max 30 chars)
- [ ] **Description:** Clear, accurate description of all features (1-2 paragraphs)
- [ ] **Keywords:** church, community, giving, prayer, events, bible, sermons, groups
- [ ] **Screenshots:** 6.7" (iPhone 15 Pro Max) + 6.5" (iPhone 11 Pro Max) + iPad
  - At least 3 screenshots showing: feed, giving, events/check-in
  - No placeholder/lorem ipsum text in screenshots
- [ ] **App Icon:** 1024x1024px, no alpha/transparency, no rounded corners (Apple adds them)
- [ ] **Category:** Primary: Lifestyle. Secondary: Social Networking
- [ ] **Age Rating:** 4+ (no mature content, no gambling, no horror)
- [ ] **Privacy Policy URL:** (see section 1)
- [ ] **Support URL:** A page where users can get help
- [ ] **Marketing URL:** Optional but recommended

### Google Play Console
- [ ] **App Title:** Shepard - Church Community (max 30 chars)
- [ ] **Short Description:** (max 80 chars) "Connect with your church — giving, prayer, events, groups & more"
- [ ] **Full Description:** (max 4000 chars) Detailed feature list
- [ ] **Screenshots:** Phone (min 2, max 8), 7" tablet, 10" tablet
- [ ] **Feature Graphic:** 1024x500px banner image
- [ ] **App Icon:** 512x512px
- [ ] **Category:** Social
- [ ] **Content Rating:** Complete the IARC questionnaire (will rate as "Everyone")
- [ ] **Target Audience:** 13+ (app has social features)
- [ ] **Data Safety Form:** (see section 4)
- [ ] **Privacy Policy URL:** (see section 1)

---

## 9. Technical Requirements

### Apple
- [ ] Built with iOS 26 SDK (as of April 2026)
- [ ] Universal app (iPhone + iPad) or iPhone-only with justification
- [ ] No private API usage
- [ ] Privacy manifest (PrivacyInfo.xcprivacy) for required reason APIs
  - Expo handles this automatically for most cases
  - Run `npx expo prebuild` and verify the manifest is generated
- [ ] App must not crash on launch (test on physical device)
- [ ] All features must work — no placeholder screens, no "coming soon" stubs

### Google
- [ ] Target API level 35+ (Android 15)
- [ ] Signed with upload key (Expo EAS handles this)
- [ ] **Closed testing:** If personal developer account (created after Nov 2023):
  - Must run closed test with 12+ opted-in testers for 14+ consecutive days
  - BEFORE you can apply for production access
  - Organization accounts skip this requirement
- [ ] No crashes, ANRs, or broken features
- [ ] All declared permissions must be used (remove unused permissions from AndroidManifest)

### Expo-Specific
- [ ] Run `eas build --platform ios` and `eas build --platform android` for production builds
- [ ] Test on physical devices (not just simulator)
- [ ] Verify `app.json` / `app.config.js` has correct bundle IDs, version numbers, and permissions
- [ ] Ensure `EXPO_PUBLIC_API_URL` is set to the production Render URL (not localhost)

---

## 10. Permissions Justification

Both stores require you to explain WHY each permission is needed:

| Permission | Justification | Required? |
|------------|--------------|-----------|
| Camera | Take photos for posts, profile picture, and comment attachments | Yes |
| Photo Library | Select existing photos for posts and media uploads | Yes |
| Location (When In Use) | Check-in geo-verification at church services | Yes |
| Push Notifications | Message notifications, event reminders, prayer updates | Yes |
| Microphone | Record voice notes in direct messages | If voice notes are implemented |

- [ ] Each permission must show a **custom usage description** string (not the default iOS text)
  - Example: `NSCameraUsageDescription: "Shepard needs access to your camera to take photos for posts and your profile picture."`
  - Example: `NSLocationWhenInUseUsageDescription: "Shepard uses your location to verify check-in at church services."`

---

## 11. Google Play Closed Testing (If Personal Account)

If your Google Play Console is a **personal developer account** (not organization):

1. [ ] Create a closed testing track in Play Console
2. [ ] Upload your AAB (Android App Bundle) to closed testing
3. [ ] Add 12+ testers (email addresses with Google accounts)
4. [ ] Share the opt-in link with testers
5. [ ] Wait 14 consecutive days with all 12 testers opted in
6. [ ] After 14 days, apply for production access
7. [ ] Google reviews and responds within ~7 days

**Tip:** If you have a Google Workspace / organization account, you can skip this and go straight to production.

---

## 12. Pre-Submission Testing Checklist

Run through these before submitting:

### Critical Path Testing
- [ ] Fresh install → sign up → browse feed → works
- [ ] Login with existing account → loads dashboard → works
- [ ] Make a post with text → appears in feed → works
- [ ] Make a post with image → uploads and displays → works
- [ ] Send a direct message → recipient receives it → works
- [ ] Open events → RSVP → works
- [ ] Open giving → make a donation (test mode) → works
- [ ] View badge collection → shows earned/locked badges → works
- [ ] Open Settings → delete account → confirms and deletes → works
- [ ] Receive a push notification → tap → navigates to correct screen → works
- [ ] App works offline gracefully (no crash, shows "No connection" message)
- [ ] Rotate device → UI doesn't break
- [ ] Background the app → return → state preserved

### Apple-Specific
- [ ] Test on iPhone SE (smallest screen) — UI doesn't clip
- [ ] Test on iPad — app doesn't crash (even if iPhone-only)
- [ ] Dark mode — app doesn't have invisible text or broken styles

### Google-Specific
- [ ] Test on Android 12, 13, 14, 15 — no crashes
- [ ] Back button behavior — navigates correctly, doesn't exit unexpectedly
- [ ] Permissions — denied permissions don't crash the app (graceful fallback)

---

## Summary: What's Already Built vs What's Needed

### Already Built (Backend)
| Feature | Status |
|---------|--------|
| Account deletion (`DELETE /api/users/me`) | Built |
| Push notification system (Expo) | Built |
| Notification preferences per type | Built |
| Content moderation (report posts) | Built |
| Stripe Connect donations (exempt from IAP) | Built |
| Demo data in test church (New Birth Test) | Built |
| Age-appropriate content (no mature features) | Built |
| Data export capability | Built |

### Needs to Be Created
| Item | Owner | Priority |
|------|-------|----------|
| Privacy Policy page (hosted URL) | Business/Legal | **CRITICAL** — both stores require |
| Terms of Service page (hosted URL) | Business/Legal | **CRITICAL** — both stores require |
| Demo reviewer account in Supabase | Backend | **CRITICAL** — Apple requires |
| "Report" button on posts/comments/profiles | Mobile team | **HIGH** — required for UGC apps |
| "Block User" functionality | Mobile + Backend | **HIGH** — required for UGC apps |
| Pre-prompt modal before push permission request | Mobile team | **HIGH** — Apple best practice |
| "Delete Account" button in Settings screen | Mobile team | **CRITICAL** — Apple will reject without this |
| Privacy Policy link in Settings screen | Mobile team | **CRITICAL** |
| Terms of Service link in Settings screen | Mobile team | **CRITICAL** |
| App screenshots (6+ per platform) | Design team | **CRITICAL** |
| App icon (1024x1024 for Apple, 512x512 for Google) | Design team | **CRITICAL** |
| Feature graphic for Google Play (1024x500) | Design team | **HIGH** |
| iOS permission usage description strings | Mobile team | **CRITICAL** |
| Google Play Data Safety form completion | Mobile team | **CRITICAL** |
| Apple App Privacy label completion | Mobile team | **CRITICAL** |
| Google Play closed testing (14 days, 12 testers) | Mobile team | **HIGH** (personal accounts only) |

---

## Sources
- [Apple App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple Account Deletion Requirement](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Apple Privacy Manifests](https://docs.expo.dev/guides/apple-privacy/)
- [Google Play Developer Program Policy](https://support.google.com/googleplay/android-developer/answer/16810878)
- [Google Play Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Google Play Testing Requirements](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Expo App Store Best Practices](https://docs.expo.dev/distribution/app-stores/)
- [Stripe Digital Goods / In-App Purchases](https://docs.stripe.com/mobile/digital-goods)
- [App Store Review Guidelines Checklist 2026](https://nextnative.dev/blog/app-store-review-guidelines)
- [Google Play Rejection Reasons 2026](https://primetestlab.com/blog/google-play-app-rejection-rate-2026)
