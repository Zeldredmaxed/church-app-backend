# Mobile Handoff — IG/FB-style Pinch-Zoom-Crop Video Uploads

Backend is fully wired for Mux Direct Upload + per-post crop metadata. Mobile can now build the pinch-zoom-crop UX without re-encoding video client-side.

---

## End-to-end flow

```
┌──────────┐   1. POST /api/media/mux-upload     ┌──────────┐
│  Mobile  │ ───────────────────────────────────▶│ Backend  │
│          │ ◀───── { uploadId, uploadUrl }──────│          │
│          │                                     └──────────┘
│          │   2. PUT raw video bytes
│          │ ─────────────────────────────────────▶ Mux
│          │
│          │   3. POST /api/posts                  ┌──────────┐
│          │     { content, videoMuxUploadId,    ▶│ Backend  │
│          │       videoCropRect }                 │          │
│          │ ◀──── post { videoMuxPlaybackId:     │          │
│          │           null (still processing) }  └──────────┘
│          │
│          │   4. Mux → backend webhook
│          │      video.upload.asset_created
│          │      video.asset.ready
│          │      → backend updates post.video_mux_playback_id
│          │
│          │   5. Refresh feed / poll post
│          │ ───────────────────────────────────▶ Backend
│          │ ◀──── post { videoMuxPlaybackId: 'abc...' }
└──────────┘
```

---

## Step 1 — Request a Direct Upload URL

```http
POST /api/media/mux-upload
Authorization: Bearer <JWT>
Content-Type: application/json

{}                                  // body is optional; corsOrigin only needed for web
```

Native mobile clients don't need to send anything. Web clients should pass their origin (`{ "corsOrigin": "https://app.shepardapp.com" }`).

Response:

```json
{
  "uploadId": "muxupload_AbCdEf123...",
  "uploadUrl": "https://storage.googleapis.com/video-storage-gcp.../<signed>"
}
```

Errors:
- `400` — no active tenant context (call `POST /api/auth/switch-tenant` first)
- `403` — current tier doesn't include `videoUploads` (gate the Record button on tier check)

---

## Step 2 — Upload the raw video to Mux

PUT the bytes straight to `uploadUrl`. Show your upload progress UI — Mux supports `Content-Range` for resumable uploads on mid-flaky connections.

```js
await fetch(uploadUrl, {
  method: 'PUT',
  headers: { 'Content-Type': 'video/mp4' },
  body: videoFile,
});
```

No auth header needed — the URL is pre-signed. **The bytes never touch our backend** — that's the whole point of Direct Upload (avoids our Render bandwidth bill).

---

## Step 3 — Create the post with crop metadata

```http
POST /api/posts
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "content": "Sunday vibes",
  "mediaType": "video",
  "videoMuxUploadId": "muxupload_AbCdEf123...",
  "videoCropRect": {
    "x": 0.10,
    "y": 0.20,
    "width": 0.80,
    "height": 0.60,
    "aspectRatio": 1
  }
}
```

`videoCropRect` is **normalized to the source video's dimensions** (`0..1`, origin top-left). `aspectRatio` is the target frame's `width / height` (1 = square, 0.8 = 4:5 portrait, 1.91 = landscape). All five fields are optional — omit `videoCropRect` entirely for un-cropped video.

Response (the post object — videoMuxPlaybackId is usually `null` at this moment because Mux is still processing):

```json
{
  "id": "post-uuid",
  "authorId": "user-uuid",
  "content": "Sunday vibes",
  "mediaType": "video",
  "videoMuxPlaybackId": null,
  "videoCropRect": { "x": 0.10, "y": 0.20, "width": 0.80, "height": 0.60, "aspectRatio": 1 },
  "createdAt": "2026-05-14T...",
  ...
}
```

The mobile should render this immediately with a "Processing..." overlay over the placeholder thumbnail.

---

## Step 4 — Wait for the playback ID (poll OR Supabase Realtime)

Two options:

**A. Poll** — GET `/api/posts/:id` every 2-5s while `videoMuxPlaybackId` is null. Stop after 60s (Mux should finish in <30s for typical short clips; if longer something probably errored).

**B. Supabase Realtime** — subscribe to the `posts` table (already in the publication for in-app notifications work) and listen for `UPDATE` events on the post you just created. When `videoMuxPlaybackId` flips from `null` to a string, swap the placeholder for the actual `Video` component. This is the slicker UX.

---

## Step 5 — Play with crop applied

You get back:

```json
{
  "videoMuxPlaybackId": "xyz123",
  "videoCropRect": { "x": 0.1, "y": 0.2, "width": 0.8, "height": 0.6, "aspectRatio": 1 }
}
```

Stream URL: `https://stream.mux.com/${videoMuxPlaybackId}.m3u8`

To apply the crop on playback, wrap the player in a container with the target aspect ratio and CSS-transform the video to "punch out" the crop window:

```tsx
function CroppedVideo({ playbackId, crop }) {
  if (!crop) {
    return <Video source={{ uri: `https://stream.mux.com/${playbackId}.m3u8` }} />;
  }

  // Scale the video so the crop window fills the frame, then translate
  // to move the crop origin to (0, 0).
  const scaleX = 1 / crop.width;
  const scaleY = 1 / crop.height;
  const translateX = -crop.x * scaleX * 100;   // in percent of the container width
  const translateY = -crop.y * scaleY * 100;

  return (
    <View style={{ aspectRatio: crop.aspectRatio ?? 1, overflow: 'hidden' }}>
      <Video
        source={{ uri: `https://stream.mux.com/${playbackId}.m3u8` }}
        style={{
          width: '100%',
          height: '100%',
          transform: [
            { translateX: `${translateX}%` },
            { translateY: `${translateY}%` },
            { scaleX },
            { scaleY },
          ],
          transformOrigin: '0 0',
        }}
      />
    </View>
  );
}
```

(Pseudocode; adapt to your `expo-av` / `mux-player-react-native` setup. The math is: scale up by `1/cropDimension` so the cropped region maps to 100%, then translate to align the crop origin.)

**Trade-off:** The full video is still downloaded and decoded — only the visible portion is rendered. This is the same approach Instagram uses for legacy uncropped videos and is fine for the launch. If bandwidth becomes a concern we'll add a server-side transcode worker that re-encodes the asset with the crop baked in (the crop rect is already stored on `pending_video_uploads.crop_rect` ready for that job).

---

## Edge cases

- **Upload abandoned** — Mobile gets the upload URL but never PUTs bytes. The `pending_video_uploads` row sits at `status='awaiting_upload'`; a future cleanup job will purge orphans older than 24h. No mobile action needed.
- **Mux processing error** — Webhook sets `status='errored'` and `error_message`. There's no separate notification yet; mobile should poll/realtime and surface "Video failed to process" if `videoMuxPlaybackId` stays null after ~2 min.
- **Post created before upload finishes** — Handled. The webhook backfills `videoMuxPlaybackId` on the post when Mux is ready. Mobile must handle the `null → string` transition.
- **Post created with an already-finished upload** — Also handled. If Mux already fired `video.asset.ready` before the mobile called `POST /api/posts`, the backend will set `videoMuxPlaybackId` immediately in the create response.

---

## What changed on the response shape

Every post response (feed, single, saved, archive, profile, campus feed, "my posts") now includes:

```ts
videoCropRect: {
  x: number;          // 0..1
  y: number;          // 0..1
  width: number;      // 0..1
  height: number;     // 0..1
  aspectRatio?: number;
} | null
```

`videoMuxPlaybackId` is unchanged. Image posts and text posts always return `videoCropRect: null`.

---

## Env vars (deploy)

Three env vars needed on Render:

| Var | Where to get it | Notes |
|---|---|---|
| `MUX_TOKEN_ID` | Mux Dashboard → Settings → Access Tokens | "Mux Video" scope, write access |
| `MUX_TOKEN_SECRET` | Same | Paired with TOKEN_ID |
| `MUX_WEBHOOK_SECRET` | Mux Dashboard → Settings → Webhooks | Already set if past video flow worked |

Webhook URL to register in Mux: `https://<api-host>/api/webhooks/mux` (already handles `video.upload.asset_created`, `video.asset.ready`, `video.asset.errored`, `video.upload.errored`).

---

## Summary

- **`POST /api/media/mux-upload`** — gets you a signed URL. Upload bytes directly to Mux.
- **`POST /api/posts`** with `videoMuxUploadId` + optional `videoCropRect` — creates the post. Backend links the upload to the post; webhook fills in the playback ID asynchronously.
- **All post responses** include `videoCropRect` so the player can apply CSS-side crop on render.

No backend dependency on what crop framework you use on the mobile side — you do the visual editing, you send us the four normalized numbers.
