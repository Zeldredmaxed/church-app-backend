/**
 * Seeds 250 platform-wide Shepard badges.
 * Run: node seed-platform-badges.js
 *
 * These badges are global (is_system = true) and shared across ALL tenants.
 * tenant_id is set to a special "platform" UUID — the app treats is_system badges
 * as visible to everyone regardless of their tenant.
 */
const { Client } = require('pg');

// Use the actual tenant for FK constraint compliance.
// System badges are identified by is_system = true, not by tenant_id.
// Every church sees the same system badges regardless of their tenant_id.
const PLATFORM_TENANT_ID = '6cfdebb0-29cc-42aa-96fc-44e21b2a9c71'; // New Birth Test
const SYSTEM_USER_ID = '3c5e2c6f-7caf-4f48-8a3e-3acdc5e4c2b6'; // Zel

// All 250 badges
const BADGES = [
  // ═══════════════════════════════════════════
  // ATTENDANCE (30)
  // ═══════════════════════════════════════════
  { name: 'First Steps', desc: 'Attended your first service', icon: 'running-shoes', color: '#4CAF50', tier: 'bronze', rarity: 'common', cat: 'attendance', rule: { type: 'attendance_count', count: 1 }, order: 1 },
  { name: 'Getting Started', desc: 'Attended 3 services', icon: 'door-01', color: '#4CAF50', tier: 'bronze', rarity: 'common', cat: 'attendance', rule: { type: 'attendance_count', count: 3 }, order: 2 },
  { name: 'Regular', desc: 'Attended 5 services', icon: 'calendar-check-01', color: '#4CAF50', tier: 'bronze', rarity: 'common', cat: 'attendance', rule: { type: 'attendance_count', count: 5 }, order: 3 },
  { name: 'Committed', desc: 'Attended 10 services', icon: 'calendar-check-01', color: '#2196F3', tier: 'silver', rarity: 'common', cat: 'attendance', rule: { type: 'attendance_count', count: 10 }, order: 4 },
  { name: 'Faithful 25', desc: 'Attended 25 services', icon: 'star', color: '#2196F3', tier: 'silver', rarity: 'uncommon', cat: 'attendance', rule: { type: 'attendance_count', count: 25 }, order: 5 },
  { name: 'Faithful 50', desc: 'Attended 50 services — almost a year!', icon: 'star-01', color: '#2196F3', tier: 'silver', rarity: 'uncommon', cat: 'attendance', rule: { type: 'attendance_count', count: 50 }, order: 6 },
  { name: 'Century Club', desc: 'Attended 100 services', icon: 'trophy', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'attendance', rule: { type: 'attendance_count', count: 100 }, order: 7 },
  { name: '200 Strong', desc: 'Attended 200 services', icon: 'medal-01', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'attendance', rule: { type: 'attendance_count', count: 200 }, order: 8 },
  { name: '500 Sundays', desc: 'Attended 500 services — nearly a decade!', icon: 'crown', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'attendance', rule: { type: 'attendance_count', count: 500 }, order: 9 },
  { name: 'Thousand Services', desc: 'Attended 1,000 services', icon: 'diamond-01', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'attendance', rule: { type: 'attendance_count', count: 1000 }, order: 10 },
  { name: 'Week Warrior', desc: '2 consecutive weeks of attendance', icon: 'clock-01', color: '#4CAF50', tier: 'bronze', rarity: 'common', cat: 'attendance', rule: { type: 'attendance_streak', days: 2 }, order: 11 },
  { name: 'Month Strong', desc: '4 consecutive weeks of attendance', icon: 'flag-01', color: '#22C55E', tier: 'bronze', rarity: 'uncommon', cat: 'attendance', rule: { type: 'attendance_streak', days: 4 }, order: 12 },
  { name: 'Quarter Keeper', desc: '13 consecutive weeks of attendance', icon: 'shield-check', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'attendance', rule: { type: 'attendance_streak', days: 13 }, order: 13 },
  { name: 'Half Year Hero', desc: '26 consecutive weeks of attendance', icon: 'rocket-01', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'attendance', rule: { type: 'attendance_streak', days: 26 }, order: 14 },
  { name: 'Year of Faithfulness', desc: '52 consecutive weeks — a full year!', icon: 'sparkles', color: '#F59E0B', tier: 'gold', rarity: 'legendary', cat: 'attendance', rule: { type: 'attendance_streak', days: 52 }, order: 15 },
  { name: 'Two Year Streak', desc: '104 consecutive weeks of attendance', icon: 'fire', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'attendance', rule: { type: 'attendance_streak', days: 104 }, order: 16 },
  { name: 'Attended 15', desc: 'Attended 15 services', icon: 'sunrise', color: '#22C55E', tier: 'bronze', rarity: 'common', cat: 'attendance', rule: { type: 'attendance_count', count: 15 }, order: 17 },
  { name: 'Attended 20', desc: 'Attended 20 services', icon: 'sunrise', color: '#22C55E', tier: 'silver', rarity: 'common', cat: 'attendance', rule: { type: 'attendance_count', count: 20 }, order: 18 },
  { name: 'Attended 35', desc: 'Attended 35 services', icon: 'notification-03', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'attendance', rule: { type: 'attendance_count', count: 35 }, order: 19 },
  { name: 'Attended 75', desc: 'Attended 75 services', icon: 'location-01', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'attendance', rule: { type: 'attendance_count', count: 75 }, order: 20 },
  { name: 'Attended 150', desc: 'Attended 150 services', icon: 'key-01', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'attendance', rule: { type: 'attendance_count', count: 150 }, order: 21 },
  { name: 'Attended 300', desc: 'Attended 300 services', icon: 'door-01', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'attendance', rule: { type: 'attendance_count', count: 300 }, order: 22 },
  { name: 'Attended 750', desc: 'Attended 750 services', icon: 'running-shoes', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'attendance', rule: { type: 'attendance_count', count: 750 }, order: 23 },
  { name: '6 Week Streak', desc: '6 consecutive weeks', icon: 'flash', color: '#22C55E', tier: 'bronze', rarity: 'uncommon', cat: 'attendance', rule: { type: 'attendance_streak', days: 6 }, order: 24 },
  { name: '8 Week Streak', desc: '8 consecutive weeks — 2 months!', icon: 'target-02', color: '#3B82F6', tier: 'silver', rarity: 'uncommon', cat: 'attendance', rule: { type: 'attendance_streak', days: 8 }, order: 25 },
  { name: '20 Week Streak', desc: '20 consecutive weeks', icon: 'mountain', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'attendance', rule: { type: 'attendance_streak', days: 20 }, order: 26 },
  { name: '36 Week Streak', desc: '36 consecutive weeks — 9 months!', icon: 'lighthouse', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'attendance', rule: { type: 'attendance_streak', days: 36 }, order: 27 },
  { name: '78 Week Streak', desc: '78 consecutive weeks — 1.5 years!', icon: 'star', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'attendance', rule: { type: 'attendance_streak', days: 78 }, order: 28 },
  { name: '156 Week Streak', desc: '156 consecutive weeks — 3 years!', icon: 'diamond-01', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'attendance', rule: { type: 'attendance_streak', days: 156 }, order: 29 },
  { name: 'Attended 2000', desc: 'Attended 2,000 services — decades of devotion', icon: 'sparkles', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'attendance', rule: { type: 'attendance_count', count: 2000 }, order: 30 },

  // ═══════════════════════════════════════════
  // GIVING (35)
  // ═══════════════════════════════════════════
  { name: 'First Gift', desc: 'Made your first donation', icon: 'coins-01', color: '#4CAF50', tier: 'bronze', rarity: 'common', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 1 }, order: 31 },
  { name: 'Generous Start', desc: 'Donated a total of $50', icon: 'hand-heart-01', color: '#4CAF50', tier: 'bronze', rarity: 'common', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 50 }, order: 32 },
  { name: 'Cheerful Giver', desc: 'Donated a total of $100', icon: 'gift', color: '#22C55E', tier: 'bronze', rarity: 'common', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 100 }, order: 33 },
  { name: 'Faithful Steward', desc: 'Donated a total of $250', icon: 'heart-check', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 250 }, order: 34 },
  { name: 'Generous Giver', desc: 'Donated a total of $500', icon: 'hand-heart-01', color: '#3B82F6', tier: 'silver', rarity: 'uncommon', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 500 }, order: 35 },
  { name: '$1K Club', desc: 'Donated a total of $1,000', icon: 'money-send-01', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 1000 }, order: 36 },
  { name: '$2.5K Giver', desc: 'Donated a total of $2,500', icon: 'treasure-chest', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 2500 }, order: 37 },
  { name: '$5K Milestone', desc: 'Donated a total of $5,000', icon: 'diamond-01', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 5000 }, order: 38 },
  { name: '$10K Heart', desc: 'Donated a total of $10,000', icon: 'crown', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 10000 }, order: 39 },
  { name: '$25K Legacy', desc: 'Donated a total of $25,000', icon: 'trophy', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 25000 }, order: 40 },
  { name: '$50K Pillar', desc: 'Donated a total of $50,000', icon: 'lighthouse', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 50000 }, order: 41 },
  { name: '$100K Cornerstone', desc: 'Donated a total of $100,000', icon: 'church', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 100000 }, order: 42 },
  { name: '$250K Benefactor', desc: 'Donated a total of $250,000', icon: 'sparkles', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 250000 }, order: 43 },
  { name: '$500K Patron', desc: 'Donated a total of $500,000', icon: 'star', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 500000 }, order: 44 },
  { name: 'Millionaire Heart', desc: 'Donated over $1,000,000 lifetime — the ultimate act of generosity', icon: 'treasure-chest', color: '#EF4444', tier: 'diamond', rarity: 'mythic', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 1000000 }, order: 45 },
  { name: 'Big Gift $25', desc: 'Single donation of $25 or more', icon: 'gift', color: '#22C55E', tier: 'bronze', rarity: 'common', cat: 'giving', rule: { type: 'giving_single', threshold: 25 }, order: 46 },
  { name: 'Big Gift $50', desc: 'Single donation of $50 or more', icon: 'gift', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'giving', rule: { type: 'giving_single', threshold: 50 }, order: 47 },
  { name: 'Big Gift $100', desc: 'Single donation of $100 or more', icon: 'gift', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'giving', rule: { type: 'giving_single', threshold: 100 }, order: 48 },
  { name: 'Big Gift $250', desc: 'Single donation of $250 or more', icon: 'gift', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'giving', rule: { type: 'giving_single', threshold: 250 }, order: 49 },
  { name: 'Big Gift $500', desc: 'Single donation of $500 or more', icon: 'diamond-01', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'giving', rule: { type: 'giving_single', threshold: 500 }, order: 50 },
  { name: 'Big Gift $1K', desc: 'Single donation of $1,000 or more', icon: 'diamond-01', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'giving', rule: { type: 'giving_single', threshold: 1000 }, order: 51 },
  { name: 'First Fundraiser Gift', desc: 'Made your first fundraiser donation', icon: 'donation', color: '#4CAF50', tier: 'bronze', rarity: 'common', cat: 'giving', rule: { type: 'fundraiser_donation_count', min: 1 }, order: 52 },
  { name: '5 Fundraiser Gifts', desc: 'Donated to 5 fundraisers', icon: 'gift', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'giving', rule: { type: 'fundraiser_donation_count', min: 5 }, order: 53 },
  { name: '10 Fundraiser Gifts', desc: 'Donated to 10 fundraisers', icon: 'heart-check', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'giving', rule: { type: 'fundraiser_donation_count', min: 10 }, order: 54 },
  { name: '25 Fundraiser Gifts', desc: 'Donated to 25 fundraisers', icon: 'treasure-chest', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'giving', rule: { type: 'fundraiser_donation_count', min: 25 }, order: 55 },
  { name: '50 Fundraiser Gifts', desc: 'Donated to 50 fundraisers', icon: 'crown', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'giving', rule: { type: 'fundraiser_donation_count', min: 50 }, order: 56 },
  { name: '$100 Fundraiser Giving', desc: 'Total fundraiser donations: $100', icon: 'coins-01', color: '#22C55E', tier: 'bronze', rarity: 'common', cat: 'giving', rule: { type: 'fundraiser_donation_total', threshold: 10000 }, order: 57 },
  { name: '$500 Fundraiser Giving', desc: 'Total fundraiser donations: $500', icon: 'money-send-01', color: '#3B82F6', tier: 'silver', rarity: 'uncommon', cat: 'giving', rule: { type: 'fundraiser_donation_total', threshold: 50000 }, order: 58 },
  { name: '$1K Fundraiser Giving', desc: 'Total fundraiser donations: $1,000', icon: 'treasure-chest', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'giving', rule: { type: 'fundraiser_donation_total', threshold: 100000 }, order: 59 },
  { name: '$5K Fundraiser Giving', desc: 'Total fundraiser donations: $5,000', icon: 'diamond-01', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'giving', rule: { type: 'fundraiser_donation_total', threshold: 500000 }, order: 60 },
  { name: '$10K Fundraiser Giving', desc: 'Total fundraiser donations: $10,000', icon: 'trophy', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'giving', rule: { type: 'fundraiser_donation_total', threshold: 1000000 }, order: 61 },
  { name: '$750 Giver', desc: 'Donated a total of $750', icon: 'hand-heart-01', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 750 }, order: 62 },
  { name: '$1.5K Giver', desc: 'Donated a total of $1,500', icon: 'coins-01', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 1500 }, order: 63 },
  { name: '$7.5K Giver', desc: 'Donated a total of $7,500', icon: 'money-send-01', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 7500 }, order: 64 },
  { name: '$15K Giver', desc: 'Donated a total of $15,000', icon: 'lighthouse', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'giving', rule: { type: 'giving_lifetime', threshold: 15000 }, order: 65 },

  // ═══════════════════════════════════════════
  // SOCIAL & ENGAGEMENT — POSTS (15)
  // ═══════════════════════════════════════════
  { name: 'First Post', desc: 'Created your first post', icon: 'pen-tool-01', color: '#4CAF50', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'post_count', min: 1 }, order: 66 },
  { name: 'Getting Vocal', desc: 'Created 5 posts', icon: 'message-01', color: '#4CAF50', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'post_count', min: 5 }, order: 67 },
  { name: '10 Posts', desc: 'Created 10 posts', icon: 'share-01', color: '#22C55E', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'post_count', min: 10 }, order: 68 },
  { name: 'Content Creator', desc: 'Created 25 posts', icon: 'video-01', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'post_count', min: 25 }, order: 69 },
  { name: '50 Posts', desc: 'Created 50 posts', icon: 'pen-tool-01', color: '#3B82F6', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'post_count', min: 50 }, order: 70 },
  { name: 'Prolific Poster', desc: 'Created 100 posts', icon: 'share-01', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'engagement', rule: { type: 'post_count', min: 100 }, order: 71 },
  { name: '250 Posts', desc: 'Created 250 posts', icon: 'megaphone-01', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'engagement', rule: { type: 'post_count', min: 250 }, order: 72 },
  { name: '500 Posts', desc: 'Created 500 posts', icon: 'megaphone-01', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'engagement', rule: { type: 'post_count', min: 500 }, order: 73 },
  { name: '1K Posts', desc: 'Created 1,000 posts', icon: 'sparkles', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'engagement', rule: { type: 'post_count', min: 1000 }, order: 74 },
  { name: '2.5K Posts', desc: 'Created 2,500 posts', icon: 'fire', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'engagement', rule: { type: 'post_count', min: 2500 }, order: 75 },
  { name: '5K Posts', desc: 'Created 5,000 posts', icon: 'fire', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'post_count', min: 5000 }, order: 76 },
  { name: '10K Posts', desc: 'Created 10,000 posts', icon: 'crown', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'post_count', min: 10000 }, order: 77 },

  // COMMENTS (12)
  { name: 'First Comment', desc: 'Left your first comment', icon: 'message-01', color: '#4CAF50', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'comment_count', min: 1 }, order: 78 },
  { name: 'Conversationalist', desc: 'Left 10 comments', icon: 'message-multiple-01', color: '#22C55E', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'comment_count', min: 10 }, order: 79 },
  { name: '25 Comments', desc: 'Left 25 comments', icon: 'message-multiple-01', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'comment_count', min: 25 }, order: 80 },
  { name: 'Discussion Leader', desc: 'Left 50 comments', icon: 'message-multiple-01', color: '#3B82F6', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'comment_count', min: 50 }, order: 81 },
  { name: '100 Comments', desc: 'Left 100 comments', icon: 'megaphone-01', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'engagement', rule: { type: 'comment_count', min: 100 }, order: 82 },
  { name: '250 Comments', desc: 'Left 250 comments', icon: 'voice', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'engagement', rule: { type: 'comment_count', min: 250 }, order: 83 },
  { name: '500 Comments', desc: 'Left 500 comments', icon: 'voice', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'engagement', rule: { type: 'comment_count', min: 500 }, order: 84 },
  { name: '1K Comments', desc: 'Left 1,000 comments', icon: 'sparkles', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'engagement', rule: { type: 'comment_count', min: 1000 }, order: 85 },
  { name: '2.5K Comments', desc: 'Left 2,500 comments', icon: 'fire', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'engagement', rule: { type: 'comment_count', min: 2500 }, order: 86 },
  { name: '5K Comments', desc: 'Left 5,000 comments', icon: 'crown', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'comment_count', min: 5000 }, order: 87 },
  { name: '10K Comments', desc: 'Left 10,000 comments', icon: 'diamond-01', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'comment_count', min: 10000 }, order: 88 },
  { name: '50K Comments', desc: 'Left 50,000 comments', icon: 'star', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'comment_count', min: 50000 }, order: 89 },

  // MESSAGES (10)
  { name: 'First Message', desc: 'Sent your first direct message', icon: 'mail-01', color: '#4CAF50', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'message_count', min: 1 }, order: 90 },
  { name: 'Chatty', desc: 'Sent 25 messages', icon: 'phone-01', color: '#22C55E', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'message_count', min: 25 }, order: 91 },
  { name: 'Connector', desc: 'Sent 100 messages', icon: 'link-04', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'message_count', min: 100 }, order: 92 },
  { name: '250 Messages', desc: 'Sent 250 messages', icon: 'message-01', color: '#3B82F6', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'message_count', min: 250 }, order: 93 },
  { name: '500 Messages', desc: 'Sent 500 messages', icon: 'message-01', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'engagement', rule: { type: 'message_count', min: 500 }, order: 94 },
  { name: '1K Messages', desc: 'Sent 1,000 messages', icon: 'message-multiple-01', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'engagement', rule: { type: 'message_count', min: 1000 }, order: 95 },
  { name: '5K Messages', desc: 'Sent 5,000 messages', icon: 'sparkles', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'engagement', rule: { type: 'message_count', min: 5000 }, order: 96 },
  { name: '10K Messages', desc: 'Sent 10,000 messages', icon: 'fire', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'engagement', rule: { type: 'message_count', min: 10000 }, order: 97 },
  { name: '50K Messages', desc: 'Sent 50,000 messages', icon: 'crown', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'message_count', min: 50000 }, order: 98 },
  { name: '100K Messages', desc: 'Sent 100,000 messages', icon: 'diamond-01', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'message_count', min: 100000 }, order: 99 },

  // TOTAL INTERACTIONS (13)
  { name: '100 Interactions', desc: '100 total posts, comments, messages & likes', icon: 'hand-pointing-up', color: '#4CAF50', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'total_interactions', min: 100 }, order: 100 },
  { name: '500 Interactions', desc: '500 total interactions', icon: 'puzzle', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'total_interactions', min: 500 }, order: 101 },
  { name: '1K Interactions', desc: '1,000 total interactions', icon: 'flash', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'engagement', rule: { type: 'total_interactions', min: 1000 }, order: 102 },
  { name: '2.5K Interactions', desc: '2,500 total interactions', icon: 'rocket-01', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'engagement', rule: { type: 'total_interactions', min: 2500 }, order: 103 },
  { name: '5K Interactions', desc: '5,000 total interactions', icon: 'rocket-01', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'engagement', rule: { type: 'total_interactions', min: 5000 }, order: 104 },
  { name: '10K Interactions', desc: '10,000 total interactions', icon: 'fire', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'engagement', rule: { type: 'total_interactions', min: 10000 }, order: 105 },
  { name: '25K Interactions', desc: '25,000 total interactions', icon: 'star', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'engagement', rule: { type: 'total_interactions', min: 25000 }, order: 106 },
  { name: '50K Interactions', desc: '50,000 total interactions', icon: 'crown', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'total_interactions', min: 50000 }, order: 107 },
  { name: '100K Interactions', desc: '100,000 total interactions', icon: 'diamond-01', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'total_interactions', min: 100000 }, order: 108 },
  { name: '250K Interactions', desc: '250,000 total interactions', icon: 'sparkles', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'total_interactions', min: 250000 }, order: 109 },
  { name: '500K Interactions', desc: '500,000 total interactions', icon: 'star', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'total_interactions', min: 500000 }, order: 110 },
  { name: 'Voice of a Generation', desc: '1,000,000 total interactions — a million acts of community', icon: 'megaphone-01', color: '#EF4444', tier: 'diamond', rarity: 'mythic', cat: 'engagement', rule: { type: 'total_interactions', min: 1000000 }, order: 111 },

  // ═══════════════════════════════════════════
  // PRAYER (25)
  // ═══════════════════════════════════════════
  { name: 'First Prayer', desc: 'Submitted your first prayer request', icon: 'hand-prayer', color: '#9C27B0', tier: 'bronze', rarity: 'common', cat: 'spiritual', rule: { type: 'prayer_count', min: 1 }, order: 112 },
  { name: 'Prayer Life', desc: 'Submitted 5 prayer requests', icon: 'candle-02', color: '#9C27B0', tier: 'bronze', rarity: 'common', cat: 'spiritual', rule: { type: 'prayer_count', min: 5 }, order: 113 },
  { name: '10 Prayers', desc: 'Submitted 10 prayer requests', icon: 'hand-prayer', color: '#9C27B0', tier: 'silver', rarity: 'uncommon', cat: 'spiritual', rule: { type: 'prayer_count', min: 10 }, order: 114 },
  { name: '25 Prayers', desc: 'Submitted 25 prayer requests', icon: 'peace-sign', color: '#9C27B0', tier: 'silver', rarity: 'uncommon', cat: 'spiritual', rule: { type: 'prayer_count', min: 25 }, order: 115 },
  { name: '50 Prayers', desc: 'Submitted 50 prayer requests', icon: 'moon-02', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'spiritual', rule: { type: 'prayer_count', min: 50 }, order: 116 },
  { name: '100 Prayers', desc: 'Submitted 100 prayer requests', icon: 'sun-03', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'spiritual', rule: { type: 'prayer_count', min: 100 }, order: 117 },
  { name: '250 Prayers', desc: 'Submitted 250 prayer requests', icon: 'sparkles', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'spiritual', rule: { type: 'prayer_count', min: 250 }, order: 118 },
  { name: '500 Prayers', desc: 'Submitted 500 prayer requests', icon: 'lighthouse', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'spiritual', rule: { type: 'prayer_count', min: 500 }, order: 119 },
  { name: '1K Prayers', desc: 'Submitted 1,000 prayer requests', icon: 'angel', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'spiritual', rule: { type: 'prayer_count', min: 1000 }, order: 120 },
  { name: '2.5K Prayers', desc: 'Submitted 2,500 prayer requests', icon: 'star', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'spiritual', rule: { type: 'prayer_count', min: 2500 }, order: 121 },
  { name: '5K Prayers', desc: 'Submitted 5,000 prayer requests', icon: 'fire', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'spiritual', rule: { type: 'prayer_count', min: 5000 }, order: 122 },
  { name: '10K Prayers', desc: 'Submitted 10,000 prayer requests', icon: 'crown', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'spiritual', rule: { type: 'prayer_count', min: 10000 }, order: 123 },
  { name: '25K Prayers', desc: 'Submitted 25,000 prayer requests', icon: 'diamond-01', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'spiritual', rule: { type: 'prayer_count', min: 25000 }, order: 124 },
  { name: '50K Prayers', desc: 'Submitted 50,000 prayer requests', icon: 'sparkles', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'spiritual', rule: { type: 'prayer_count', min: 50000 }, order: 125 },
  { name: 'Prayer Mountain', desc: '100,000 prayer requests — a lifetime of intercession', icon: 'hand-prayer', color: '#EF4444', tier: 'diamond', rarity: 'mythic', cat: 'spiritual', rule: { type: 'prayer_count', min: 100000 }, order: 126 },
  { name: '15 Prayers', desc: 'Submitted 15 prayer requests', icon: 'hand-prayer', color: '#9C27B0', tier: 'silver', rarity: 'uncommon', cat: 'spiritual', rule: { type: 'prayer_count', min: 15 }, order: 127 },
  { name: '35 Prayers', desc: 'Submitted 35 prayer requests', icon: 'candle-02', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'spiritual', rule: { type: 'prayer_count', min: 35 }, order: 128 },
  { name: '75 Prayers', desc: 'Submitted 75 prayer requests', icon: 'moon-02', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'spiritual', rule: { type: 'prayer_count', min: 75 }, order: 129 },
  { name: '150 Prayers', desc: 'Submitted 150 prayer requests', icon: 'sun-03', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'spiritual', rule: { type: 'prayer_count', min: 150 }, order: 130 },
  { name: '750 Prayers', desc: 'Submitted 750 prayer requests', icon: 'lighthouse', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'spiritual', rule: { type: 'prayer_count', min: 750 }, order: 131 },
  { name: '1.5K Prayers', desc: 'Submitted 1,500 prayer requests', icon: 'fire', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'spiritual', rule: { type: 'prayer_count', min: 1500 }, order: 132 },
  { name: '3.5K Prayers', desc: 'Submitted 3,500 prayer requests', icon: 'angel', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'spiritual', rule: { type: 'prayer_count', min: 3500 }, order: 133 },
  { name: '7.5K Prayers', desc: 'Submitted 7,500 prayer requests', icon: 'crown', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'spiritual', rule: { type: 'prayer_count', min: 7500 }, order: 134 },
  { name: '15K Prayers', desc: 'Submitted 15,000 prayer requests', icon: 'diamond-01', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'spiritual', rule: { type: 'prayer_count', min: 15000 }, order: 135 },
  { name: '35K Prayers', desc: 'Submitted 35,000 prayer requests', icon: 'star', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'spiritual', rule: { type: 'prayer_count', min: 35000 }, order: 136 },

  // ═══════════════════════════════════════════
  // VOLUNTEERING (25)
  // ═══════════════════════════════════════════
  { name: 'First Serve', desc: 'Logged your first volunteer hour', icon: 'helping-hand', color: '#795548', tier: 'bronze', rarity: 'common', cat: 'service', rule: { type: 'volunteer_hours', min: 1 }, order: 137 },
  { name: 'Helping Hand', desc: 'Logged 5 volunteer hours', icon: 'apron', color: '#795548', tier: 'bronze', rarity: 'common', cat: 'service', rule: { type: 'volunteer_hours', min: 5 }, order: 138 },
  { name: '10 Hours Served', desc: 'Logged 10 volunteer hours', icon: 'shield-check', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'service', rule: { type: 'volunteer_hours', min: 10 }, order: 139 },
  { name: '25 Hours Served', desc: 'Logged 25 volunteer hours', icon: 'wrench-01', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'service', rule: { type: 'volunteer_hours', min: 25 }, order: 140 },
  { name: '50 Hours Served', desc: 'Logged 50 volunteer hours', icon: 'cooking-pot', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'service', rule: { type: 'volunteer_hours', min: 50 }, order: 141 },
  { name: '100 Hours Served', desc: 'Logged 100 volunteer hours', icon: 'first-aid-kit', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'service', rule: { type: 'volunteer_hours', min: 100 }, order: 142 },
  { name: '250 Hours Served', desc: 'Logged 250 volunteer hours', icon: 'trophy', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'service', rule: { type: 'volunteer_hours', min: 250 }, order: 143 },
  { name: '500 Hours Served', desc: 'Logged 500 volunteer hours', icon: 'medal-01', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'service', rule: { type: 'volunteer_hours', min: 500 }, order: 144 },
  { name: '1K Hours Served', desc: 'Logged 1,000 volunteer hours', icon: 'crown', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'service', rule: { type: 'volunteer_hours', min: 1000 }, order: 145 },
  { name: '2.5K Hours Served', desc: 'Logged 2,500 volunteer hours', icon: 'diamond-01', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'service', rule: { type: 'volunteer_hours', min: 2500 }, order: 146 },
  { name: '5K Hours Served', desc: 'Logged 5,000 volunteer hours', icon: 'sparkles', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'service', rule: { type: 'volunteer_hours', min: 5000 }, order: 147 },
  { name: '15 Hours Served', desc: 'Logged 15 volunteer hours', icon: 'paint-brush-01', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'service', rule: { type: 'volunteer_hours', min: 15 }, order: 148 },
  { name: '35 Hours Served', desc: 'Logged 35 volunteer hours', icon: 'shopping-bag-01', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'service', rule: { type: 'volunteer_hours', min: 35 }, order: 149 },
  { name: '75 Hours Served', desc: 'Logged 75 volunteer hours', icon: 'truck', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'service', rule: { type: 'volunteer_hours', min: 75 }, order: 150 },
  { name: '150 Hours Served', desc: 'Logged 150 volunteer hours', icon: 'shield-check', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'service', rule: { type: 'volunteer_hours', min: 150 }, order: 151 },
  { name: '200 Hours Served', desc: 'Logged 200 volunteer hours', icon: 'helping-hand', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'service', rule: { type: 'volunteer_hours', min: 200 }, order: 152 },
  { name: '350 Hours Served', desc: 'Logged 350 volunteer hours', icon: 'wrench-01', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'service', rule: { type: 'volunteer_hours', min: 350 }, order: 153 },
  { name: '750 Hours Served', desc: 'Logged 750 volunteer hours', icon: 'cooking-pot', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'service', rule: { type: 'volunteer_hours', min: 750 }, order: 154 },
  { name: '1.5K Hours Served', desc: 'Logged 1,500 volunteer hours', icon: 'trophy', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'service', rule: { type: 'volunteer_hours', min: 1500 }, order: 155 },
  { name: '2K Hours Served', desc: 'Logged 2,000 volunteer hours', icon: 'medal-01', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'service', rule: { type: 'volunteer_hours', min: 2000 }, order: 156 },
  { name: '3.5K Hours Served', desc: 'Logged 3,500 volunteer hours', icon: 'crown', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'service', rule: { type: 'volunteer_hours', min: 3500 }, order: 157 },
  { name: '4K Hours Served', desc: 'Logged 4,000 volunteer hours', icon: 'star', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'service', rule: { type: 'volunteer_hours', min: 4000 }, order: 158 },
  { name: '7.5K Hours Served', desc: 'Logged 7,500 volunteer hours', icon: 'fire', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'service', rule: { type: 'volunteer_hours', min: 7500 }, order: 159 },
  { name: '10K Hours Served', desc: 'Logged 10,000 volunteer hours', icon: 'diamond-01', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'service', rule: { type: 'volunteer_hours', min: 10000 }, order: 160 },
  { name: '3 Hours Served', desc: 'Logged 3 volunteer hours', icon: 'helping-hand', color: '#795548', tier: 'bronze', rarity: 'common', cat: 'service', rule: { type: 'volunteer_hours', min: 3 }, order: 161 },

  // ═══════════════════════════════════════════
  // COMMUNITY & GROUPS (20)
  // ═══════════════════════════════════════════
  { name: 'Joined a Group', desc: 'Joined your first group', icon: 'user-group', color: '#FF9800', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'group_count', min: 1 }, order: 162 },
  { name: 'Group Explorer', desc: 'Joined 2 groups', icon: 'puzzle', color: '#FF9800', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'group_count', min: 2 }, order: 163 },
  { name: 'Community Builder', desc: 'Joined 3 groups', icon: 'bridge', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'group_count', min: 3 }, order: 164 },
  { name: '5 Groups', desc: 'Joined 5 groups', icon: 'globe-02', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'group_count', min: 5 }, order: 165 },
  { name: '7 Groups', desc: 'Joined 7 groups', icon: 'handshake', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'engagement', rule: { type: 'group_count', min: 7 }, order: 166 },
  { name: 'Group Leader', desc: 'Joined 10 groups', icon: 'user-group', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'engagement', rule: { type: 'group_count', min: 10 }, order: 167 },
  { name: '15 Groups', desc: 'Joined 15 groups', icon: 'handshake', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'engagement', rule: { type: 'group_count', min: 15 }, order: 168 },
  { name: '20 Groups', desc: 'Joined 20 groups', icon: 'globe-02', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'engagement', rule: { type: 'group_count', min: 20 }, order: 169 },
  { name: '25 Groups', desc: 'Joined 25 groups', icon: 'crown', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'engagement', rule: { type: 'group_count', min: 25 }, order: 170 },
  { name: '50 Groups', desc: 'Joined 50 groups', icon: 'diamond-01', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'group_count', min: 50 }, order: 171 },

  // FOLLOWERS (10)
  { name: 'First Follower', desc: 'Someone followed you!', icon: 'user-add-01', color: '#4CAF50', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'follower_count', min: 1 }, order: 172 },
  { name: '5 Followers', desc: '5 people follow you', icon: 'user-group', color: '#22C55E', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'follower_count', min: 5 }, order: 173 },
  { name: '10 Followers', desc: '10 people follow you', icon: 'user-group', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'follower_count', min: 10 }, order: 174 },
  { name: '25 Followers', desc: '25 people follow you', icon: 'megaphone-01', color: '#3B82F6', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'follower_count', min: 25 }, order: 175 },
  { name: '50 Followers', desc: '50 people follow you', icon: 'megaphone-01', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'engagement', rule: { type: 'follower_count', min: 50 }, order: 176 },
  { name: '100 Followers', desc: '100 people follow you', icon: 'globe-02', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'engagement', rule: { type: 'follower_count', min: 100 }, order: 177 },
  { name: '250 Followers', desc: '250 people follow you', icon: 'lighthouse', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'engagement', rule: { type: 'follower_count', min: 250 }, order: 178 },
  { name: '500 Followers', desc: '500 people follow you', icon: 'lighthouse', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'engagement', rule: { type: 'follower_count', min: 500 }, order: 179 },
  { name: '1K Followers', desc: '1,000 people follow you', icon: 'crown', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'follower_count', min: 1000 }, order: 180 },
  { name: '5K Followers', desc: '5,000 people follow you', icon: 'star', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'follower_count', min: 5000 }, order: 181 },

  // ═══════════════════════════════════════════
  // SPIRITUAL JOURNEY (20)
  // ═══════════════════════════════════════════
  { name: 'Baptized', desc: 'Publicly declared your faith through baptism', icon: 'droplet', color: '#00BCD4', tier: 'gold', rarity: 'epic', cat: 'spiritual', rule: { type: 'baptized' }, order: 182 },
  { name: 'Members Class', desc: 'Completed the new members class', icon: 'graduation-scroll', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'spiritual', rule: { type: 'members_class' }, order: 183 },
  { name: 'Shepherd of Thousands', desc: '10,000 followers — a voice for the community', icon: 'user-group', color: '#EF4444', tier: 'diamond', rarity: 'mythic', cat: 'engagement', rule: { type: 'follower_count', min: 10000 }, order: 184 },

  // ═══════════════════════════════════════════
  // CONSISTENCY & STREAKS (20)
  // ═══════════════════════════════════════════
  { name: '3-Day Streak', desc: '3 consecutive days on the app', icon: 'sunrise', color: '#4CAF50', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'login_streak', min: 3 }, order: 185 },
  { name: '7-Day Streak', desc: '7 consecutive days on the app', icon: 'sunrise', color: '#22C55E', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'login_streak', min: 7 }, order: 186 },
  { name: '14-Day Streak', desc: '14 consecutive days on the app', icon: 'flash', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'login_streak', min: 14 }, order: 187 },
  { name: '21-Day Streak', desc: '21 consecutive days — a new habit!', icon: 'flash', color: '#3B82F6', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'login_streak', min: 21 }, order: 188 },
  { name: '30-Day Streak', desc: '30 consecutive days on the app', icon: 'fire', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'engagement', rule: { type: 'login_streak', min: 30 }, order: 189 },
  { name: '60-Day Streak', desc: '60 consecutive days — 2 months strong!', icon: 'fire', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'engagement', rule: { type: 'login_streak', min: 60 }, order: 190 },
  { name: '90-Day Streak', desc: '90 consecutive days — a full quarter!', icon: 'rocket-01', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'engagement', rule: { type: 'login_streak', min: 90 }, order: 191 },
  { name: '120-Day Streak', desc: '120 consecutive days — 4 months!', icon: 'rocket-01', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'engagement', rule: { type: 'login_streak', min: 120 }, order: 192 },
  { name: '180-Day Streak', desc: '180 consecutive days — half a year!', icon: 'star', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'engagement', rule: { type: 'login_streak', min: 180 }, order: 193 },
  { name: '270-Day Streak', desc: '270 consecutive days — 9 months!', icon: 'star', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'engagement', rule: { type: 'login_streak', min: 270 }, order: 194 },
  { name: '365-Day Streak', desc: '365 consecutive days — a full year!', icon: 'trophy', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'engagement', rule: { type: 'login_streak', min: 365 }, order: 195 },
  { name: '500-Day Streak', desc: '500 consecutive days', icon: 'diamond-01', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'login_streak', min: 500 }, order: 196 },
  { name: '730-Day Streak', desc: '730 consecutive days — 2 full years!', icon: 'diamond-01', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'login_streak', min: 730 }, order: 197 },
  { name: '1000-Day Streak', desc: '1,000 consecutive days', icon: 'crown', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'login_streak', min: 1000 }, order: 198 },
  { name: '1825-Day Streak', desc: '1,825 consecutive days — 5 years!', icon: 'crown', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'login_streak', min: 1825 }, order: 199 },
  { name: '2555-Day Streak', desc: '2,555 consecutive days — 7 years!', icon: 'sparkles', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'login_streak', min: 2555 }, order: 200 },
  { name: 'Eternal Flame', desc: '3,650 consecutive days — 10 years without missing a single day', icon: 'fire', color: '#EF4444', tier: 'diamond', rarity: 'mythic', cat: 'engagement', rule: { type: 'login_streak', min: 3650 }, order: 201 },
  { name: '45-Day Streak', desc: '45 consecutive days', icon: 'fire', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'engagement', rule: { type: 'login_streak', min: 45 }, order: 202 },
  { name: '150-Day Streak', desc: '150 consecutive days — 5 months!', icon: 'rocket-01', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'engagement', rule: { type: 'login_streak', min: 150 }, order: 203 },
  { name: '1460-Day Streak', desc: '1,460 consecutive days — 4 years!', icon: 'star', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'login_streak', min: 1460 }, order: 204 },

  // ═══════════════════════════════════════════
  // FOLLOWING (10)
  // ═══════════════════════════════════════════
  { name: 'First Follow', desc: 'Followed your first person', icon: 'user-add-01', color: '#4CAF50', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'following_count', min: 1 }, order: 205 },
  { name: 'Following 5', desc: 'Following 5 people', icon: 'handshake', color: '#22C55E', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'following_count', min: 5 }, order: 206 },
  { name: 'Following 10', desc: 'Following 10 people', icon: 'handshake', color: '#22C55E', tier: 'silver', rarity: 'common', cat: 'engagement', rule: { type: 'following_count', min: 10 }, order: 207 },
  { name: 'Following 25', desc: 'Following 25 people', icon: 'user-group', color: '#3B82F6', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'following_count', min: 25 }, order: 208 },
  { name: 'Following 50', desc: 'Following 50 people', icon: 'globe-02', color: '#3B82F6', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'following_count', min: 50 }, order: 209 },
  { name: 'Following 100', desc: 'Following 100 people', icon: 'globe-02', color: '#A855F7', tier: 'gold', rarity: 'rare', cat: 'engagement', rule: { type: 'following_count', min: 100 }, order: 210 },
  { name: 'Following 250', desc: 'Following 250 people', icon: 'handshake', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'engagement', rule: { type: 'following_count', min: 250 }, order: 211 },
  { name: 'Following 500', desc: 'Following 500 people', icon: 'bridge', color: '#F59E0B', tier: 'platinum', rarity: 'legendary', cat: 'engagement', rule: { type: 'following_count', min: 500 }, order: 212 },
  { name: 'Following 1K', desc: 'Following 1,000 people', icon: 'globe-02', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'following_count', min: 1000 }, order: 213 },
  { name: 'Following 5K', desc: 'Following 5,000 people', icon: 'crown', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'following_count', min: 5000 }, order: 214 },

  // ═══════════════════════════════════════════
  // ADDITIONAL SOCIAL FILLERS TO REACH 250 (36)
  // ═══════════════════════════════════════════
  { name: '3 Posts', desc: 'Created 3 posts', icon: 'pen-tool-01', color: '#4CAF50', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'post_count', min: 3 }, order: 215 },
  { name: '15 Posts', desc: 'Created 15 posts', icon: 'share-01', color: '#22C55E', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'post_count', min: 15 }, order: 216 },
  { name: '75 Posts', desc: 'Created 75 posts', icon: 'video-01', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'engagement', rule: { type: 'post_count', min: 75 }, order: 217 },
  { name: '150 Posts', desc: 'Created 150 posts', icon: 'megaphone-01', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'engagement', rule: { type: 'post_count', min: 150 }, order: 218 },
  { name: '350 Posts', desc: 'Created 350 posts', icon: 'share-01', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'engagement', rule: { type: 'post_count', min: 350 }, order: 219 },
  { name: '750 Posts', desc: 'Created 750 posts', icon: 'sparkles', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'engagement', rule: { type: 'post_count', min: 750 }, order: 220 },
  { name: '5 Comments', desc: 'Left 5 comments', icon: 'message-01', color: '#4CAF50', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'comment_count', min: 5 }, order: 221 },
  { name: '75 Comments', desc: 'Left 75 comments', icon: 'message-multiple-01', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'engagement', rule: { type: 'comment_count', min: 75 }, order: 222 },
  { name: '150 Comments', desc: 'Left 150 comments', icon: 'voice', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'engagement', rule: { type: 'comment_count', min: 150 }, order: 223 },
  { name: '350 Comments', desc: 'Left 350 comments', icon: 'megaphone-01', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'engagement', rule: { type: 'comment_count', min: 350 }, order: 224 },
  { name: '750 Comments', desc: 'Left 750 comments', icon: 'sparkles', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'engagement', rule: { type: 'comment_count', min: 750 }, order: 225 },
  { name: '50 Messages', desc: 'Sent 50 messages', icon: 'message-01', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'message_count', min: 50 }, order: 226 },
  { name: '150 Messages', desc: 'Sent 150 messages', icon: 'link-04', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'engagement', rule: { type: 'message_count', min: 150 }, order: 227 },
  { name: '750 Messages', desc: 'Sent 750 messages', icon: 'message-01', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'engagement', rule: { type: 'message_count', min: 750 }, order: 228 },
  { name: '2.5K Messages', desc: 'Sent 2,500 messages', icon: 'message-multiple-01', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'engagement', rule: { type: 'message_count', min: 2500 }, order: 229 },
  { name: '25K Messages', desc: 'Sent 25,000 messages', icon: 'sparkles', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'message_count', min: 25000 }, order: 230 },
  { name: '250 Interactions', desc: '250 total interactions', icon: 'puzzle', color: '#22C55E', tier: 'bronze', rarity: 'common', cat: 'engagement', rule: { type: 'total_interactions', min: 250 }, order: 231 },
  { name: '750 Interactions', desc: '750 total interactions', icon: 'flash', color: '#22C55E', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'total_interactions', min: 750 }, order: 232 },
  { name: '1.5K Interactions', desc: '1,500 total interactions', icon: 'rocket-01', color: '#3B82F6', tier: 'silver', rarity: 'rare', cat: 'engagement', rule: { type: 'total_interactions', min: 1500 }, order: 233 },
  { name: '3.5K Interactions', desc: '3,500 total interactions', icon: 'fire', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'engagement', rule: { type: 'total_interactions', min: 3500 }, order: 234 },
  { name: '7.5K Interactions', desc: '7,500 total interactions', icon: 'star', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'engagement', rule: { type: 'total_interactions', min: 7500 }, order: 235 },
  { name: '15K Interactions', desc: '15,000 total interactions', icon: 'crown', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'engagement', rule: { type: 'total_interactions', min: 15000 }, order: 236 },
  { name: '35K Interactions', desc: '35,000 total interactions', icon: 'diamond-01', color: '#A855F7', tier: 'platinum', rarity: 'epic', cat: 'engagement', rule: { type: 'total_interactions', min: 35000 }, order: 237 },
  { name: '75K Interactions', desc: '75,000 total interactions', icon: 'fire', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'total_interactions', min: 75000 }, order: 238 },
  { name: '150K Interactions', desc: '150,000 total interactions', icon: 'star', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'total_interactions', min: 150000 }, order: 239 },
  { name: '350K Interactions', desc: '350,000 total interactions', icon: 'crown', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'total_interactions', min: 350000 }, order: 240 },
  { name: '750K Interactions', desc: '750,000 total interactions', icon: 'sparkles', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'total_interactions', min: 750000 }, order: 241 },
  { name: '15 Followers', desc: '15 people follow you', icon: 'user-group', color: '#3B82F6', tier: 'silver', rarity: 'uncommon', cat: 'engagement', rule: { type: 'follower_count', min: 15 }, order: 242 },
  { name: '75 Followers', desc: '75 people follow you', icon: 'megaphone-01', color: '#3B82F6', tier: 'gold', rarity: 'rare', cat: 'engagement', rule: { type: 'follower_count', min: 75 }, order: 243 },
  { name: '150 Followers', desc: '150 people follow you', icon: 'globe-02', color: '#A855F7', tier: 'gold', rarity: 'epic', cat: 'engagement', rule: { type: 'follower_count', min: 150 }, order: 244 },
  { name: '2.5K Followers', desc: '2,500 people follow you', icon: 'lighthouse', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'follower_count', min: 2500 }, order: 245 },
  { name: '7.5K Followers', desc: '7,500 people follow you', icon: 'crown', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'engagement', rule: { type: 'follower_count', min: 7500 }, order: 246 },
  { name: '100 Fundraiser Gifts', desc: 'Donated to 100 fundraisers', icon: 'sparkles', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'giving', rule: { type: 'fundraiser_donation_count', min: 100 }, order: 247 },
  { name: '$25K Fundraiser Giving', desc: 'Total fundraiser donations: $25,000', icon: 'crown', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'giving', rule: { type: 'fundraiser_donation_total', threshold: 2500000 }, order: 248 },
  { name: '$50K Fundraiser Giving', desc: 'Total fundraiser donations: $50,000', icon: 'diamond-01', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'giving', rule: { type: 'fundraiser_donation_total', threshold: 5000000 }, order: 249 },
  { name: '$100K Fundraiser Giving', desc: 'Total fundraiser donations: $100,000', icon: 'star', color: '#F59E0B', tier: 'diamond', rarity: 'legendary', cat: 'giving', rule: { type: 'fundraiser_donation_total', threshold: 10000000 }, order: 250 },
];

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:04291992Ddcc...@db.fymcroumzokahctpsvaq.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('Connected. Seeding', BADGES.length, 'platform badges...');

  // Run schema migration first
  await client.query(`ALTER TABLE public.badges ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT false`);
  await client.query(`ALTER TABLE public.badges ADD COLUMN IF NOT EXISTS rarity_tier TEXT DEFAULT 'common'`);
  console.log('  Schema columns added.');

  // Delete existing system badges to reseed cleanly (preserves church-custom badges)
  await client.query(`DELETE FROM public.badges WHERE is_system = true`);
  console.log('  Existing system badges cleared.');

  // Insert in batches
  let inserted = 0;
  for (const b of BADGES) {
    await client.query(
      `INSERT INTO public.badges
        (tenant_id, name, description, icon, color, tier, category, auto_award_rule, display_order, created_by, is_system, rarity_tier, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, true)
       ON CONFLICT DO NOTHING`,
      [
        PLATFORM_TENANT_ID,
        b.name, b.desc, b.icon, b.color, b.tier, b.cat,
        JSON.stringify(b.rule),
        b.order,
        SYSTEM_USER_ID,
        b.rarity,
      ],
    );
    inserted++;
  }

  console.log(`  Inserted ${inserted} badges.`);

  // Verify
  const [{ count }] = await client.query(`SELECT COUNT(*)::int AS count FROM public.badges WHERE is_system = true`).then(r => r.rows);
  console.log(`  Verified: ${count} system badges in database.`);

  // Count by rarity
  const rarities = await client.query(`SELECT rarity_tier, COUNT(*)::int AS cnt FROM public.badges WHERE is_system = true GROUP BY rarity_tier ORDER BY cnt DESC`);
  console.log('  By rarity:', rarities.rows.map(r => `${r.rarity_tier}: ${r.cnt}`).join(', '));

  await client.end();
  console.log('Done.');
}

run().catch(e => { console.error(e); process.exit(1); });
