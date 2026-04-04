# Service Provisioning Walkthrough

Set up each service below, then provide the API keys so they can be added to your Render deployment.

---

## 1. Redis (Upstash) — Free Tier

Upstash provides serverless Redis with a generous free tier (10,000 commands/day).

### Steps

1. Go to [console.upstash.com](https://console.upstash.com)
2. Sign up with your Google account (denzellz72@gmail.com)
3. Click **Create Database**
4. Configure:
   - **Name:** `church-app-redis`
   - **Type:** Regional
   - **Region:** `US-East-1` (matches your Render/Supabase region)
   - **Eviction:** Disabled (we want persistent rate-limit counters)
5. Click **Create**
6. On the database details page, find the **Connect** section
7. Copy these values:
   - **Endpoint** (looks like `usw1-something.upstash.io`)
   - **Port** (usually `6379`)
   - **Password** (a long alphanumeric string)

### What to give me
```
REDIS_HOST=<endpoint>
REDIS_PORT=<port>
REDIS_PASSWORD=<password>
```

---

## 2. Stripe — Test Mode (Free)

Stripe provides test API keys immediately — no business verification needed.

### Steps

1. Go to [dashboard.stripe.com/register](https://dashboard.stripe.com/register)
2. Create an account with your email
3. You do NOT need to activate your account for test mode — skip any onboarding prompts
4. Make sure **Test mode** is toggled ON (top-right toggle switch)
5. Go to **Developers** (left sidebar) → **API keys**
6. Copy the **Secret key** (starts with `sk_test_`)
7. Now set up the webhook:
   - Go to **Developers** → **Webhooks**
   - Click **Add endpoint**
   - **Endpoint URL:** `https://church-app-backend-27hc.onrender.com/api/webhooks/stripe`
   - **Events to listen for:** Click "Select events" and add:
     - `account.updated`
     - `payment_intent.succeeded`
     - `payment_intent.payment_failed`
   - Click **Add endpoint**
   - On the endpoint details page, click **Reveal** under "Signing secret"
   - Copy the signing secret (starts with `whsec_`)

### What to give me
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## 3. AWS S3 — Free Tier (12 months)

AWS S3 free tier includes 5GB storage, 20,000 GET requests, 2,000 PUT requests/month.

### Steps

#### 3a. Create an AWS Account (if you don't have one)
1. Go to [aws.amazon.com](https://aws.amazon.com) → **Create an AWS Account**
2. Complete the signup (requires credit card, but free tier won't charge you)

#### 3b. Create an S3 Bucket
1. Go to [S3 Console](https://s3.console.aws.amazon.com/s3/buckets)
2. Click **Create bucket**
3. Configure:
   - **Bucket name:** `church-app-media` (must be globally unique — add random suffix if taken, e.g., `church-app-media-7x2k`)
   - **Region:** `US East (N. Virginia) us-east-1`
   - **Block all public access:** Leave CHECKED (we use pre-signed URLs, not public access)
4. Click **Create bucket**

#### 3c. Set up CORS on the bucket
1. Click on your new bucket → **Permissions** tab → **CORS configuration** → Edit
2. Paste this CORS policy:
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```
3. Click **Save changes**

#### 3d. Create an IAM User for API Access
1. Go to [IAM Console](https://console.aws.amazon.com/iam/home)
2. Click **Users** → **Create user**
3. **User name:** `church-app-s3-user`
4. Click **Next**
5. Select **Attach policies directly**
6. Search for and select: `AmazonS3FullAccess`
   (For production, create a custom policy scoped to just your bucket — but this is fine for now)
7. Click **Next** → **Create user**
8. Click on the new user → **Security credentials** tab
9. Click **Create access key**
10. Select **Application running outside AWS** → **Next** → **Create access key**
11. Copy both:
    - **Access key ID** (starts with `AKIA...`)
    - **Secret access key** (only shown once — save it now!)

### What to give me
```
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=church-app-media
S3_REGION=us-east-1
```

---

## 4. Mux — Free Trial (No Credit Card Required)

Mux is a video API. Free trial includes 1,000 minutes of video encoding.

### Steps

1. Go to [dashboard.mux.com/signup](https://dashboard.mux.com/signup)
2. Sign up with your email
3. Once in the dashboard, go to **Settings** (gear icon, bottom-left) → **Webhooks**
4. Click **Create new webhook**
5. **URL to notify:** `https://church-app-backend-27hc.onrender.com/api/webhooks/mux`
6. Click **Create webhook**
7. After creation, you'll see the **Signing secret** — copy it

### What to give me
```
MUX_WEBHOOK_SECRET=...
```

---

## 5. OneSignal — Free Tier

OneSignal provides free push notifications for up to 10,000 subscribers.

### Steps

1. Go to [onesignal.com](https://onesignal.com) → **Sign Up Free**
2. Sign up with your email
3. Click **New App/Website**
4. **App name:** `ChurchApp`
5. Select platform: **Google Android (FCM)** and/or **Apple iOS (APNs)**
   - For now, you can skip platform config and just create the app
   - Click **Save** or **Next** through the setup wizard
6. Once the app is created, go to **Settings** → **Keys & IDs**
7. Copy:
   - **OneSignal App ID** (a UUID like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
   - **REST API Key** (a long alphanumeric string)

### What to give me
```
ONESIGNAL_APP_ID=...
ONESIGNAL_REST_API_KEY=...
```

---

## Summary Checklist

| # | Service | Sign Up URL | Time | Cost |
|---|---------|-------------|------|------|
| 1 | Upstash Redis | [console.upstash.com](https://console.upstash.com) | 2 min | Free |
| 2 | Stripe | [dashboard.stripe.com/register](https://dashboard.stripe.com/register) | 5 min | Free (test mode) |
| 3 | AWS S3 | [aws.amazon.com](https://aws.amazon.com) | 10 min | Free tier (12 months) |
| 4 | Mux | [dashboard.mux.com/signup](https://dashboard.mux.com/signup) | 3 min | Free trial |
| 5 | OneSignal | [onesignal.com](https://onesignal.com) | 3 min | Free |

Once you have all the keys, paste them here and I'll update your Render deployment in one shot.
