# Backend Update: Storage Tracking System

> **Date:** April 9, 2026
> **From:** Backend Team
> **For:** Admin Dashboard Team (Next.js) + Mobile App Team (React Native)
> **Priority:** BREAKING CHANGE — media uploads will fail without the update below

---

## Breaking Change: `fileSize` Now Required on Uploads

`POST /api/media/presigned-url` now requires a `fileSize` field (integer, in bytes).

**Before:**
```json
{ "filename": "photo.jpg", "contentType": "image/jpeg" }
```

**After:**
```json
{ "filename": "photo.jpg", "contentType": "image/jpeg", "fileSize": 2048576 }
```

If `fileSize` is missing, the backend returns `400 Bad Request`.

**How to get the file size:**
```typescript
// React Native (from image picker / document picker)
const fileSize = selectedFile.fileSize || selectedFile.size;

// Web (from input element or drag-and-drop)
const fileSize = file.size;

// Then pass it in your upload request:
const { uploadUrl, fileKey } = await api.post('/media/presigned-url', {
  filename: file.name,
  contentType: file.type,
  fileSize: fileSize,  // <-- NEW REQUIRED FIELD
});
```

**Validation rules:**
- Must be an integer
- Minimum: 1 byte
- Maximum: 524,288,000 bytes (500 MB hard cap per file)

---

## What Happens Now When Churches Upload Files

1. **Before upload:** Backend checks if the church has enough storage left for this file
2. **If under limit:** Presigned URL is generated normally, file is recorded in the storage ledger
3. **If over limit:** Upload is blocked with `403 Forbidden`:
```json
{
  "statusCode": 403,
  "message": "Storage limit reached (9.8 GB / 10 GB). Upgrade your plan or free up space by deleting old files.",
  "error": "Forbidden"
}
```

**Storage limits by tier:**
| Tier | Limit |
|------|-------|
| Standard ($29/mo) | 10 GB |
| Premium ($79/mo) | 100 GB |
| Enterprise ($199/mo) | Unlimited |

---

## Automatic Notifications to Admins

The backend now sends in-app notifications to all admins/pastors when storage hits thresholds:

- **80%** — "Your church is using 8.2 GB of 10 GB (82%). Consider upgrading to get more storage."
- **95%** — "Your church is using 9.5 GB of 10 GB (95%). Uploads will be blocked soon. Upgrade your plan or free up space."

These are standard notifications (same `GET /api/notifications` endpoint). The notification type is `storage_alert` with this payload:

```json
{
  "title": "Storage Getting Full",
  "body": "Your church is using 8.2 GB of 10 GB (82%). Consider upgrading to get more storage.",
  "percentUsed": 82,
  "usedBytes": 8804682752,
  "limitBytes": 10737418240,
  "alertPercent": 80
}
```

**Mobile:** Show these like any other notification. Consider adding an "Upgrade Plan" deep link.

**Admin Dashboard:** Consider showing a storage bar in the sidebar or settings page that turns yellow at 80% and red at 95%.

---

## New Admin Endpoints (Dashboard Only)

These power the "Manage Storage" page on the admin dashboard.

### GET /api/storage — Usage Summary

```json
{
  "usedBytes": 3221225472,
  "usedFormatted": "3.0 GB",
  "limitBytes": 10737418240,
  "limitFormatted": "10.0 GB",
  "percentUsed": 30.0,
  "fileCount": 247,
  "tier": "standard",
  "updatedAt": "2026-04-09T..."
}
```

Use this for the storage progress bar on the dashboard.

### GET /api/storage/breakdown — By Content Type

```json
{
  "breakdown": [
    { "sourceType": "sermon", "fileCount": 12, "totalBytes": 1610612736, "totalFormatted": "1.5 GB" },
    { "sourceType": "gallery", "fileCount": 180, "totalBytes": 858993459, "totalFormatted": "819.2 MB" },
    { "sourceType": "post", "fileCount": 45, "totalBytes": 524288000, "totalFormatted": "500.0 MB" },
    { "sourceType": "story", "fileCount": 10, "totalBytes": 227541197, "totalFormatted": "217.1 MB" }
  ]
}
```

Use this for a pie/bar chart showing "What's using your storage?"

### GET /api/storage/files?limit=50 — Largest Files

```json
{
  "files": [
    {
      "id": "file-uuid",
      "fileKey": "tenants/.../sermon-recording.mp4",
      "fileSizeBytes": 314572800,
      "fileSizeFormatted": "300.0 MB",
      "contentType": "video/mp4",
      "sourceType": "sermon",
      "sourceId": "sermon-uuid",
      "uploadedByName": "Pastor Mike",
      "createdAt": "2026-02-15T..."
    }
  ]
}
```

Use this for the "Manage Storage" file list. Show file name, size, who uploaded it, and a delete button.

### DELETE /api/storage/files/:fileId — Delete a File

Returns `204 No Content`. Storage is immediately reclaimed.

**Important:** This only removes the file from the storage ledger and frees up the quota. The actual S3 object should also be deleted — the backend handles this. The source content (post, sermon, etc.) still exists but its media URL will become a broken link. Consider warning the admin: "This will remove the file from storage. The associated post/sermon will lose its media attachment."

---

## Recommended UI

### Admin Dashboard — Settings > Storage Page

```
┌─────────────────────────────────────────────┐
│  Storage Usage                              │
│  ████████████░░░░░░░░  3.0 GB / 10 GB (30%)│
│                                             │
│  Upgrade to Premium for 100 GB →            │
├─────────────────────────────────────────────┤
│  What's using your storage?                 │
│  ▓▓▓▓▓▓▓▓ Sermons      1.5 GB  (50%)       │
│  ▓▓▓▓▓    Gallery       819 MB  (27%)       │
│  ▓▓▓      Posts         500 MB  (17%)       │
│  ▓        Stories       217 MB  (6%)        │
├─────────────────────────────────────────────┤
│  Largest Files                    [View All]│
│  sermon-recording.mp4    300 MB   [Delete]  │
│  retreat-video.mp4       250 MB   [Delete]  │
│  choir-performance.mp4   180 MB   [Delete]  │
└─────────────────────────────────────────────┘
```

### Mobile App — Settings

Show a simple storage bar on the church settings screen:

```
Storage: 3.0 GB / 10 GB used
████████████░░░░░░░░░░ 30%
```

No file management on mobile — that's an admin dashboard task. Mobile just shows the bar so admins are aware when they're uploading from their phone.

### Both Apps — Upload Error Handling

When `POST /api/media/presigned-url` returns `403` with `"Storage limit reached"`, show:

```
┌───────────────────────────────────────┐
│  Storage Full                         │
│                                       │
│  Your church has used all 10 GB of    │
│  storage. To upload more files:       │
│                                       │
│  • Delete old files in Settings       │
│  • Upgrade to Premium (100 GB)        │
│                                       │
│  [Manage Storage]    [Upgrade Plan]   │
└───────────────────────────────────────┘
```

---

## Quick Checklist

### Mobile App Team
- [ ] Add `fileSize: file.size` to all `POST /api/media/presigned-url` calls
- [ ] Handle `403` response on upload (show "Storage Full" dialog)
- [ ] Show `storage_alert` notifications from `GET /api/notifications`
- [ ] (Optional) Show storage bar on settings screen using `GET /api/storage`

### Admin Dashboard Team
- [ ] Add `fileSize: file.size` to all `POST /api/media/presigned-url` calls
- [ ] Handle `403` response on upload (show "Storage Full" dialog with upgrade CTA)
- [ ] Build "Manage Storage" page under Settings (usage bar, breakdown chart, file list with delete)
- [ ] Show `storage_alert` notifications
- [ ] (Optional) Show storage indicator in sidebar that turns yellow at 80%, red at 95%
