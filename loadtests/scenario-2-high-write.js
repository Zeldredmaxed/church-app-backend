import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { BASE_URL, authHeaders, randomContent } from './helpers.js';

/**
 * Scenario 2: High Write Load — "Crucial Event"
 *
 * Simulates a burst of content creation: users posting updates, commenting
 * on posts, and interacting during a live event or announcement.
 *
 * Load profile:
 *   - Ramp up to 500 concurrent writers over 1 minute
 *   - Sustain 500 users for 5 minutes
 *   - Ramp down over 1 minute
 *
 * Performance targets:
 *   - Post creation: p95 < 500ms
 *   - Comment creation: p95 < 500ms
 *   - Error rate: < 1%
 *
 * What to watch:
 *   - BullMQ queue depth (social-fanout, notifications)
 *   - PostgreSQL write IOPS and WAL throughput
 *   - Redis memory usage (fan-out write amplification)
 *   - Connection pool saturation (TypeORM max connections)
 *
 * Run:
 *   k6 run -e BASE_URL=https://staging.example.com/api \
 *          -e JWT_TOKEN=<token> \
 *          scenario-2-high-write.js
 */

const postLatency = new Trend('post_create_latency', true);
const commentLatency = new Trend('comment_create_latency', true);
const errorRate = new Rate('request_errors');
const postsCreated = new Counter('posts_created');
const commentsCreated = new Counter('comments_created');

export const options = {
  stages: [
    { duration: '1m', target: 500 },   // Ramp up
    { duration: '5m', target: 500 },   // Sustained write pressure
    { duration: '1m', target: 0 },     // Ramp down
  ],
  thresholds: {
    'post_create_latency': ['p(95)<500'],
    'comment_create_latency': ['p(95)<500'],
    'request_errors': ['rate<0.01'],
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],
  },
};

// Shared state: post IDs created during the test, used for commenting
const createdPostIds = [];

export default function () {
  const params = authHeaders();

  // 1. Create a post (primary write operation)
  const postBody = JSON.stringify({
    content: randomContent('Load test post'),
  });

  const postRes = http.post(`${BASE_URL}/posts`, postBody, params);
  const postOk = check(postRes, {
    'post: status 201': (r) => r.status === 201,
    'post: has id': (r) => {
      try { return !!JSON.parse(r.body).id; }
      catch { return false; }
    },
  });

  postLatency.add(postRes.timings.duration);
  errorRate.add(postRes.status !== 201);

  if (postOk) {
    postsCreated.add(1);
    try {
      const postId = JSON.parse(postRes.body).id;
      if (createdPostIds.length < 1000) {
        createdPostIds.push(postId);
      }
    } catch { /* ignore parse errors */ }
  }

  sleep(0.5);

  // 2. Comment on an existing post (if any exist)
  if (createdPostIds.length > 0) {
    const targetPostId = createdPostIds[
      Math.floor(Math.random() * createdPostIds.length)
    ];

    const commentBody = JSON.stringify({
      content: randomContent('Load test comment'),
    });

    const commentRes = http.post(
      `${BASE_URL}/posts/${targetPostId}/comments`,
      commentBody,
      params,
    );

    check(commentRes, {
      'comment: status 201': (r) => r.status === 201,
    });

    commentLatency.add(commentRes.timings.duration);
    errorRate.add(commentRes.status !== 201);

    if (commentRes.status === 201) {
      commentsCreated.add(1);
    }
  }

  sleep(0.5);

  // 3. Read the feed (mixed read/write pattern — realistic)
  const feedRes = http.get(`${BASE_URL}/posts`, params);
  check(feedRes, {
    'feed read during writes: status 200': (r) => r.status === 200,
  });
  errorRate.add(feedRes.status !== 200);

  // Simulate user think time
  sleep(Math.random() * 2 + 0.5);
}
