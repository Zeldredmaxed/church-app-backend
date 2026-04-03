import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { BASE_URL, authHeaders, randomContent } from './helpers.js';

/**
 * Scenario 3: Real-time Chat Load
 *
 * Simulates heavy chat usage: users sending and reading messages in
 * active channels. WebSocket (Supabase Realtime) connections are tested
 * separately — this script focuses on the HTTP API layer that persists
 * messages and triggers notifications.
 *
 * Note: Supabase Realtime (WebSocket) performance must be tested via
 * Supabase's own monitoring dashboard. k6 WebSocket support can be
 * added for end-to-end latency measurement, but the HTTP API is the
 * bottleneck we control.
 *
 * Load profile:
 *   - Ramp up to 1,000 concurrent users over 1 minute
 *   - Sustain 1,000 users for 5 minutes
 *   - Ramp down over 1 minute
 *
 * Performance targets:
 *   - Message send: p95 < 300ms
 *   - Message read: p95 < 200ms
 *   - Error rate: < 1%
 *
 * What to watch:
 *   - BullMQ queue depth (NEW_MESSAGE notifications)
 *   - OneSignal push notification delivery latency
 *   - PostgreSQL insert throughput on chat_messages
 *   - Supabase Realtime CPU/memory (via Supabase dashboard)
 *
 * Prerequisites:
 *   - Pre-created chat channels with test users as members
 *   - Set CHANNEL_IDS env var (comma-separated channel UUIDs)
 *
 * Run:
 *   k6 run -e BASE_URL=https://staging.example.com/api \
 *          -e JWT_TOKEN=<token> \
 *          -e CHANNEL_IDS=uuid1,uuid2,uuid3 \
 *          scenario-3-chat-load.js
 */

const sendLatency = new Trend('message_send_latency', true);
const readLatency = new Trend('message_read_latency', true);
const errorRate = new Rate('request_errors');
const messagesSent = new Counter('messages_sent');
const messagesRead = new Counter('messages_read');

// Parse channel IDs from environment
const CHANNEL_IDS = (__ENV.CHANNEL_IDS || '').split(',').filter(Boolean);

export const options = {
  stages: [
    { duration: '1m', target: 1000 },  // Users joining channels
    { duration: '5m', target: 1000 },  // Active chat session
    { duration: '1m', target: 0 },     // Users leaving
  ],
  thresholds: {
    'message_send_latency': ['p(95)<300'],
    'message_read_latency': ['p(95)<200'],
    'request_errors': ['rate<0.01'],
    'http_req_duration': ['p(95)<400', 'p(99)<800'],
  },
};

export default function () {
  const params = authHeaders();

  if (CHANNEL_IDS.length === 0) {
    // Fallback: list channels first, then use them
    const channelsRes = http.get(`${BASE_URL}/channels`, params);
    check(channelsRes, {
      'channels: status 200': (r) => r.status === 200,
    });

    if (channelsRes.status === 200) {
      try {
        const channels = JSON.parse(channelsRes.body);
        if (Array.isArray(channels) && channels.length > 0) {
          CHANNEL_IDS.push(...channels.map((c) => c.id).slice(0, 10));
        }
      } catch { /* ignore */ }
    }

    if (CHANNEL_IDS.length === 0) {
      sleep(1);
      return; // No channels available — skip iteration
    }
  }

  const channelId = CHANNEL_IDS[Math.floor(Math.random() * CHANNEL_IDS.length)];

  // 1. Send a message
  const msgBody = JSON.stringify({
    content: randomContent('Chat load test'),
  });

  const sendRes = http.post(
    `${BASE_URL}/channels/${channelId}/messages`,
    msgBody,
    params,
  );

  check(sendRes, {
    'send: status 201': (r) => r.status === 201,
  });

  sendLatency.add(sendRes.timings.duration);
  errorRate.add(sendRes.status !== 201);

  if (sendRes.status === 201) {
    messagesSent.add(1);
  }

  sleep(0.3);

  // 2. Read recent messages (polling pattern — simulates users scrolling)
  const readRes = http.get(
    `${BASE_URL}/channels/${channelId}/messages?limit=20`,
    params,
  );

  check(readRes, {
    'read: status 200': (r) => r.status === 200,
    'read: has messages': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.messages) && body.messages.length > 0;
      } catch { return false; }
    },
  });

  readLatency.add(readRes.timings.duration);
  errorRate.add(readRes.status !== 200);

  if (readRes.status === 200) {
    messagesRead.add(1);
  }

  sleep(0.5);

  // 3. List channels (periodic refresh)
  if (Math.random() < 0.1) {
    const listRes = http.get(`${BASE_URL}/channels`, params);
    check(listRes, {
      'channel list: status 200': (r) => r.status === 200,
    });
    errorRate.add(listRes.status !== 200);
  }

  // Simulate typing delay between messages
  sleep(Math.random() * 3 + 1);
}
