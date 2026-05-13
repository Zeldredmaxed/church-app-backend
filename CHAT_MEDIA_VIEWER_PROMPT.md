# Shepard Mobile — Chat Media Viewer (Images + Videos)

## What this is

Users report: photos and videos sent in DMs show up as small unclickable thumbnails. Videos render as images. There's no way to enlarge or play them.

The backend already exposes everything the mobile needs. This is a frontend-only fix: render based on `mediaType` and open a fullscreen viewer on tap.

**Backend origin:** `https://church-app-backend-27hc.onrender.com` — endpoints live under `/api/...`. `EXPO_PUBLIC_API_URL` should be the origin only (no `/api` suffix).

---

## What the backend already returns

`GET /api/messages/conversations/:id/messages` response shape (per message):

```ts
{
  id: "uuid",
  conversationId: "uuid",
  senderId: "uuid",
  content: string | null,        // text body, null when message is media-only
  mediaUrl: string | null,        // direct S3 URL, null when text-only
  mediaType: "image" | "video" | "audio" | null,
  createdAt: "ISO timestamp"
}
```

**You're already getting both fields** — verified live against a media message:
```json
{
  "id": "930c5791-...",
  "mediaUrl": "https://church-app-media-uploads.s3.amazonaws.com/tenants/.../1234_xxx.jpg",
  "mediaType": "image",
  "content": null
}
```

The same shape applies to send: `POST /api/messages/conversations/:id/messages` accepts `{ content?, mediaUrl?, mediaType? }` where `mediaType` must be one of `image | video | audio` when `mediaUrl` is set.

No backend changes are needed. The bug is purely render-side.

---

## The upload flow (for context — already wired)

1. Mobile picks file → calls `POST /api/media/presigned-url` with `{ filename, contentType, fileSize }`. Supported: `image/jpeg|png|gif|webp|heic|heif`, `video/mp4|quicktime|webm|x-msvideo`. 500 MB hard cap per file.
2. Backend returns `{ uploadUrl, key, publicUrl }`.
3. Mobile PUTs the file bytes directly to `uploadUrl`.
4. Mobile sends the message with `mediaUrl = publicUrl` and `mediaType` set appropriately.

If a user can already send images and videos, this part is working. The fix below is purely about rendering what was sent.

---

## Bug 1 — Videos render as images

### Cause

The chat-message-bubble component likely does something like:

```ts
{message.mediaUrl && <Image source={{ uri: message.mediaUrl }} />}
```

It doesn't branch on `mediaType`, so a video URL gets crammed into an `<Image>` — which falls back to the broken-image placeholder (or, with a poster frame, just shows a still that can't play).

### Fix

Branch on `mediaType` and render the right component:

```tsx
import { Image, View, TouchableOpacity } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';

function MessageMedia({ message, onPress }) {
  if (!message.mediaUrl) return null;

  if (message.mediaType === 'image') {
    return (
      <TouchableOpacity onPress={() => onPress(message)}>
        <Image
          source={{ uri: message.mediaUrl }}
          style={styles.thumbnail}
          resizeMode="cover"
        />
      </TouchableOpacity>
    );
  }

  if (message.mediaType === 'video') {
    return (
      <TouchableOpacity onPress={() => onPress(message)}>
        <View style={styles.thumbnail}>
          <Video
            source={{ uri: message.mediaUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode={ResizeMode.COVER}
            shouldPlay={false}
            isMuted
            usePoster
          />
          <View style={styles.playOverlay}>
            <Ionicons name="play-circle" size={56} color="rgba(255,255,255,0.95)" />
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  if (message.mediaType === 'audio') {
    // Voice notes — Bug 1 is just image/video. Audio is its own component.
    return <AudioPlayer uri={message.mediaUrl} />;
  }

  return null;
}
```

Use `expo-av` (which you almost certainly already have for voice notes) for video. If you'd rather use the newer `expo-video`, the props differ slightly — see expo docs.

**Notes:**
- `usePoster` makes the Video component show the first frame as a still while it's paused, so the thumbnail looks like the video. Without it, you see a black rectangle.
- `isMuted` + `shouldPlay={false}` keeps the in-bubble preview silent and paused; sound + play happens in the fullscreen viewer.
- The play overlay is purely visual feedback that it's tappable. Without it, users won't realize they can tap.

---

## Bug 2 — Tapping doesn't enlarge

### Fix — Fullscreen viewer

Both images and videos should open in a fullscreen modal on tap. Two patterns:

**Option A: react-native-image-viewing (just images)**

Lightweight, swipeable, pinch-to-zoom. Doesn't handle video.

```sh
npm install react-native-image-viewing
```

```tsx
import ImageView from 'react-native-image-viewing';

const [viewerImage, setViewerImage] = useState<string | null>(null);

// In the chat screen
<ImageView
  images={viewerImage ? [{ uri: viewerImage }] : []}
  imageIndex={0}
  visible={!!viewerImage}
  onRequestClose={() => setViewerImage(null)}
/>
```

**Option B: custom modal that handles both (recommended)**

One viewer for both media types — cleaner UX, you control everything:

```tsx
import { Modal, View, TouchableOpacity, StatusBar, Dimensions } from 'react-native';
import { Image } from 'expo-image';   // or react-native's Image
import { Video, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';

function MediaViewer({ message, onClose }) {
  if (!message) return null;
  const { width, height } = Dimensions.get('window');

  return (
    <Modal
      visible={!!message}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' }}>
        <TouchableOpacity
          onPress={onClose}
          style={{ position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 12 }}
        >
          <Ionicons name="close" size={32} color="#fff" />
        </TouchableOpacity>

        {message.mediaType === 'image' && (
          <Image
            source={{ uri: message.mediaUrl }}
            style={{ width, height }}
            contentFit="contain"
          />
        )}

        {message.mediaType === 'video' && (
          <Video
            source={{ uri: message.mediaUrl }}
            style={{ width, height }}
            resizeMode={ResizeMode.CONTAIN}
            useNativeControls
            shouldPlay
            isLooping={false}
          />
        )}
      </View>
    </Modal>
  );
}
```

Wire it from the chat screen:

```tsx
const [viewerMessage, setViewerMessage] = useState(null);

// In the FlatList render:
<MessageMedia message={item} onPress={setViewerMessage} />

// At the bottom of the screen, outside the list:
<MediaViewer message={viewerMessage} onClose={() => setViewerMessage(null)} />
```

`useNativeControls` on the Video component gives the user play/pause/scrubber/fullscreen-toggle/volume — no need to roll your own controls.

---

## Bonus polish — pinch-to-zoom on images

If you want pinch-to-zoom in the fullscreen image viewer (and the `react-native-image-viewing` library above gives this for free), the simplest replacement using React Native's gesture handler is [`react-native-image-zoom`](https://github.com/likashefqet/react-native-image-zoom) or [`react-native-reanimated`](https://docs.swmansion.com/react-native-reanimated/) + `react-native-gesture-handler`. Skip this in the first pass — fullscreen + tap-to-close gets you 90% of the win.

---

## Test checklist

After shipping the fix:

- [ ] Send a photo from one user to another → bubble shows a clear image thumbnail
- [ ] Tap the image bubble → fullscreen viewer opens with the full-resolution image
- [ ] Pinch-to-zoom works (if implemented) and tap-close dismisses
- [ ] Send a video from one user to another → bubble shows a video thumbnail (first frame) with a clear play overlay icon
- [ ] Tap the video bubble → fullscreen viewer opens, video starts playing with native controls
- [ ] Voice notes (existing) still work — audio messages render the existing player and don't accidentally get caught by this branch

---

## Could-be-useful backend additions (ask if you want any)

The current API gives you the URL + type, which is the minimum. If the UX would benefit from more, I can add any of these:

| Addition | Where | What it gets you |
|---|---|---|
| `mediaThumbnailUrl` | response shape | Pre-generated still for the video bubble — faster than waiting for first frame to decode, especially on slow networks |
| `mediaWidth` / `mediaHeight` | response shape | Lets the bubble reserve the right aspect ratio before the file loads — prevents the chat from jumping when an image lands |
| `mediaDurationSeconds` | response shape (video + audio) | Show "0:42" overlay on video thumbnails |
| Video transcoding via Mux | upload flow | HLS streaming instead of MP4 direct-fetch — better for long clips on cellular |

Right now the only blocker is rendering. None of the above are needed for the immediate bug. Tell me which (if any) you want and I'll wire them.
