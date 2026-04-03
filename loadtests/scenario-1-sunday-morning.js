import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { BASE_URL, GRAPHQL_URL, authHeaders, randomItem } from './helpers.js';

/**
 * Scenario 1: "Sunday Morning" — High Read Load
 *
 * Simulates the peak usage pattern: thousands of church members logging in
 * simultaneously on Sunday morning to check the feed, read notifications,
 * and browse posts.
 *
 * Load profile:
 *   - Ramp up to 5,000 concurrent users over 2 minutes
 *   - Sustain 5,000 users for 5 minutes
 *   - Ramp down over 1 minute
 *
 * Performance targets:
 *   - Feed endpoints: p95 < 200ms
 *   - Error rate: < 1%
 *
 * Prerequisites:
 *   - Staging environment with seeded data (users, posts, notifications)
 *   - Pre-generated JWT tokens for test users
 *   - Set env vars: BASE_URL, JWT_TOKEN (or JWT_TOKENS comma-separated)
 *
 * Run:
 *   k6 run -e BASE_URL=https://staging.example.com/api \
 *          -e JWT_TOKEN=<token> \
 *          scenario-1-sunday-morning.js
 */

// Custom metrics for granular analysis
const feedLatency = new Trend('feed_latency', true);
const globalFeedLatency = new Trend('global_feed_latency', true);
const notificationsLatency = new Trend('notifications_latency', true);
const errorRate = new Rate('request_errors');

export const options = {
  stages: [
    { duration: '2m', target: 5000 },  // Ramp up: congregation arriving
    { duration: '5m', target: 5000 },  // Sustained: service in progress
    { duration: '1m', target: 0 },     // Ramp down: service ends
  ],
  thresholds: {
    'feed_latency': ['p(95)<200'],
    'global_feed_latency': ['p(95)<200'],
    'notifications_latency': ['p(95)<200'],
    'request_errors': ['rate<0.01'],
    'http_req_duration': ['p(95)<300', 'p(99)<500'],
  },
};

export default function () {
  const params = authHeaders();

  // 1. Fetch tenant-scoped posts feed (most common action)
  const feedRes = http.get(`${BASE_URL}/posts`, params);
  check(feedRes, {
    'feed: status 200': (r) => r.status === 200,
    'feed: has posts array': (r) => {
      try { return Array.isArray(JSON.parse(r.body).posts); }
      catch { return false; }
    },
  });
  feedLatency.add(feedRes.timings.duration);
  errorRate.add(feedRes.status !== 200);

  sleep(1); // Simulate user reading the feed

  // 2. Fetch global feed via GraphQL
  const graphqlBody = JSON.stringify({
    query: `query {
      globalFeed(limit: 20, offset: 0) {
        posts {
          id
          content
          mediaType
          author { id fullName avatarUrl }
          latestComment { id content author { fullName } }
        }
        total
      }
    }`,
  });

  const globalRes = http.post(GRAPHQL_URL, graphqlBody, params);
  check(globalRes, {
    'globalFeed: status 200': (r) => r.status === 200,
    'globalFeed: no errors': (r) => {
      try { return !JSON.parse(r.body).errors; }
      catch { return false; }
    },
  });
  globalFeedLatency.add(globalRes.timings.duration);
  errorRate.add(globalRes.status !== 200);

  sleep(0.5);

  // 3. Fetch notifications
  const notifRes = http.get(`${BASE_URL}/notifications`, params);
  check(notifRes, {
    'notifications: status 200': (r) => r.status === 200,
  });
  notificationsLatency.add(notifRes.timings.duration);
  errorRate.add(notifRes.status !== 200);

  sleep(0.5);

  // 4. Fetch user profile (cache-friendly, lightweight)
  const profileRes = http.get(`${BASE_URL}/users/me`, params);
  check(profileRes, {
    'profile: status 200': (r) => r.status === 200,
  });
  errorRate.add(profileRes.status !== 200);

  // 5. Search for posts (simulates users searching for a sermon)
  const searchRes = http.get(
    `${BASE_URL}/search/posts?q=sermon&limit=10`,
    params,
  );
  check(searchRes, {
    'search: status 200': (r) => r.status === 200,
  });
  errorRate.add(searchRes.status !== 200);

  // Simulate user think time between page navigations
  sleep(Math.random() * 3 + 1);
}
