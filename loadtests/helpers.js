/**
 * Shared helpers for k6 load testing scripts.
 *
 * Usage:
 *   import { BASE_URL, authHeaders, randomItem } from './helpers.js';
 *
 * Environment variables (set via k6 -e flag or .env):
 *   BASE_URL   — API base URL (default: http://localhost:3000/api)
 *   JWT_TOKEN  — Pre-generated JWT for authenticated requests
 *   GRAPHQL_URL — GraphQL endpoint (default: http://localhost:3000/graphql)
 */

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api';
export const GRAPHQL_URL = __ENV.GRAPHQL_URL || 'http://localhost:3000/graphql';

/**
 * Returns standard auth + JSON headers for API requests.
 * @param {string} [token] - JWT override. Falls back to JWT_TOKEN env var.
 */
export function authHeaders(token) {
  return {
    headers: {
      'Authorization': `Bearer ${token || __ENV.JWT_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };
}

/**
 * Picks a random item from an array.
 */
export function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generates a random string for test content.
 */
export function randomContent(prefix) {
  return `${prefix} - k6 load test ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Standard response time thresholds used across all scenarios.
 */
export const THRESHOLDS = {
  read: {
    'http_req_duration{type:read}': ['p(95)<200'],     // 95th percentile < 200ms
    'http_req_failed{type:read}': ['rate<0.01'],       // < 1% error rate
  },
  write: {
    'http_req_duration{type:write}': ['p(95)<500'],    // 95th percentile < 500ms
    'http_req_failed{type:write}': ['rate<0.01'],      // < 1% error rate
  },
};
