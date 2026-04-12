/**
 * Official workflow templates for the Shepherd Workflow Marketplace.
 * These are platform-provided templates that churches can install for free or at a price.
 * Each template is a complete workflow definition with nodes and connections.
 */

export interface OfficialTemplate {
  name: string;
  description: string;
  category: string;
  tags: string[];
  triggerType: string;
  triggerConfig: Record<string, any>;
  priceCents: number;
  isOfficial: true;
  nodes: Array<{
    id: string;
    nodeType: string;
    nodeConfig: Record<string, any>;
    positionX: number;
    positionY: number;
    label: string;
  }>;
  connections: Array<{
    fromNodeId: string;
    toNodeId: string;
    branch: string;
  }>;
}

export const OFFICIAL_TEMPLATES: OfficialTemplate[] = [
  // ═══════════════════════════════════════════════════
  // ONBOARDING (5)
  // ═══════════════════════════════════════════════════

  // 1. New Member Welcome Flow
  {
    name: 'New Member Welcome Flow',
    description: 'Automatically welcomes new members with a personalized email, follows up after 3 days with an SMS, assigns tags, and alerts the pastor if the member doesn\'t attend within a week.',
    category: 'onboarding',
    tags: ['new-member', 'email', 'sms', 'follow-up', 'automation'],
    triggerType: 'new_member',
    triggerConfig: {},
    priceCents: 0,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'new_member', nodeConfig: {}, positionX: 50, positionY: 200, label: 'New Member Joins' },
      { id: 'node-2', nodeType: 'send_email', nodeConfig: { subject: 'Welcome to {{churchName}}!', body: 'We are so glad you have joined our church family! We can\'t wait to get to know you better. Here are some ways to get connected...' }, positionX: 300, positionY: 200, label: 'Welcome Email' },
      { id: 'node-3', nodeType: 'wait_duration', nodeConfig: { amount: 3, unit: 'days' }, positionX: 550, positionY: 200, label: 'Wait 3 Days' },
      { id: 'node-4', nodeType: 'send_sms', nodeConfig: { body: 'Hey {{firstName}}! Just checking in after your first visit. We\'d love to see you this Sunday! Reply if you have any questions.' }, positionX: 800, positionY: 200, label: 'Follow-up SMS' },
      { id: 'node-5', nodeType: 'assign_tag', nodeConfig: { tagName: 'New Member' }, positionX: 1050, positionY: 200, label: 'Tag: New Member' },
      { id: 'node-6', nodeType: 'wait_duration', nodeConfig: { amount: 7, unit: 'days' }, positionX: 1300, positionY: 200, label: 'Wait 7 Days' },
      { id: 'node-7', nodeType: 'check_attendance', nodeConfig: { minCount: 1, days: 14 }, positionX: 1550, positionY: 200, label: 'Attended Service?' },
      { id: 'node-8', nodeType: 'assign_tag', nodeConfig: { tagName: 'Active' }, positionX: 1800, positionY: 100, label: 'Tag: Active' },
      { id: 'node-9', nodeType: 'create_care_case', nodeConfig: { title: 'New member {{firstName}} has not attended', priority: 'medium' }, positionX: 1800, positionY: 300, label: 'Create Care Case' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'default' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'default' },
      { fromNodeId: 'node-4', toNodeId: 'node-5', branch: 'default' },
      { fromNodeId: 'node-5', toNodeId: 'node-6', branch: 'default' },
      { fromNodeId: 'node-6', toNodeId: 'node-7', branch: 'default' },
      { fromNodeId: 'node-7', toNodeId: 'node-8', branch: 'true' },
      { fromNodeId: 'node-7', toNodeId: 'node-9', branch: 'false' },
    ],
  },

  // 2. First-Time Visitor Follow-Up
  {
    name: 'First-Time Visitor Follow-Up',
    description: 'Sends a thank-you email after a visitor checks in, follows up with an SMS invite the next day, and checks if they return within a week to assign a Returning Visitor tag.',
    category: 'onboarding',
    tags: ['visitor', 'follow-up', 'email', 'sms', 'check-in'],
    triggerType: 'check_in',
    triggerConfig: {},
    priceCents: 0,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'check_in', nodeConfig: {}, positionX: 50, positionY: 200, label: 'Visitor Checks In' },
      { id: 'node-2', nodeType: 'send_email', nodeConfig: { subject: 'Thank you for visiting {{churchName}}!', body: 'It was wonderful having you with us today! We hope you felt welcomed and at home. We would love to see you again next week.' }, positionX: 300, positionY: 200, label: 'Thank-You Email' },
      { id: 'node-3', nodeType: 'wait_duration', nodeConfig: { amount: 1, unit: 'days' }, positionX: 550, positionY: 200, label: 'Wait 1 Day' },
      { id: 'node-4', nodeType: 'send_sms', nodeConfig: { body: 'Hi {{firstName}}! We loved having you visit us. Our next service is this Sunday at 10am. We\'d love to see you again!' }, positionX: 800, positionY: 200, label: 'SMS Invite' },
      { id: 'node-5', nodeType: 'wait_duration', nodeConfig: { amount: 7, unit: 'days' }, positionX: 1050, positionY: 200, label: 'Wait 7 Days' },
      { id: 'node-6', nodeType: 'check_attendance', nodeConfig: { minCount: 2, days: 14 }, positionX: 1300, positionY: 200, label: 'Returned?' },
      { id: 'node-7', nodeType: 'assign_tag', nodeConfig: { tagName: 'Returning Visitor' }, positionX: 1550, positionY: 100, label: 'Tag: Returning Visitor' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'default' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'default' },
      { fromNodeId: 'node-4', toNodeId: 'node-5', branch: 'default' },
      { fromNodeId: 'node-5', toNodeId: 'node-6', branch: 'default' },
      { fromNodeId: 'node-6', toNodeId: 'node-7', branch: 'true' },
    ],
  },

  // 3. Baptism Journey
  {
    name: 'Baptism Journey',
    description: 'After a member completes the members class, sends an email about baptism, waits 14 days, and checks if they\'ve been baptized. Creates a pastor follow-up task if not, or awards a badge and sends congratulations if yes.',
    category: 'onboarding',
    tags: ['baptism', 'spiritual-growth', 'follow-up', 'badge'],
    triggerType: 'members_class_completed',
    triggerConfig: {},
    priceCents: 200,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'members_class_completed', nodeConfig: {}, positionX: 50, positionY: 200, label: 'Members Class Done' },
      { id: 'node-2', nodeType: 'send_email', nodeConfig: { subject: 'Your Next Step: Baptism', body: 'Congratulations on completing the members class! We\'d love to talk with you about baptism as your next step in faith. Contact the church office to schedule your baptism.' }, positionX: 300, positionY: 200, label: 'Baptism Email' },
      { id: 'node-3', nodeType: 'wait_duration', nodeConfig: { amount: 14, unit: 'days' }, positionX: 550, positionY: 200, label: 'Wait 14 Days' },
      { id: 'node-4', nodeType: 'check_journey_stage', nodeConfig: { milestone: 'is_baptized' }, positionX: 800, positionY: 200, label: 'Baptized?' },
      { id: 'node-5', nodeType: 'award_badge', nodeConfig: { badgeId: 'baptized', reason: 'Completed baptism' }, positionX: 1050, positionY: 100, label: 'Award Baptized Badge' },
      { id: 'node-6', nodeType: 'send_email', nodeConfig: { subject: 'Congratulations on Your Baptism!', body: 'What an incredible step of faith! We are so proud of you and celebrate this milestone with you.' }, positionX: 1300, positionY: 100, label: 'Congratulations Email' },
      { id: 'node-7', nodeType: 'create_task', nodeConfig: { title: 'Follow up with {{firstName}} about baptism', priority: 'medium', assignedTo: 'pastor' }, positionX: 1050, positionY: 300, label: 'Pastor Follow-up Task' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'default' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'default' },
      { fromNodeId: 'node-4', toNodeId: 'node-5', branch: 'true' },
      { fromNodeId: 'node-5', toNodeId: 'node-6', branch: 'default' },
      { fromNodeId: 'node-4', toNodeId: 'node-7', branch: 'false' },
    ],
  },

  // 4. New Member Integration
  {
    name: 'New Member Integration',
    description: 'Guides new members through their first 30 days: checks attendance after a week, adds them to the New Members group, and monitors engagement at 30 days to alert the pastor if needed.',
    category: 'onboarding',
    tags: ['new-member', 'integration', 'group', 'engagement'],
    triggerType: 'new_member',
    triggerConfig: {},
    priceCents: 0,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'new_member', nodeConfig: {}, positionX: 50, positionY: 200, label: 'New Member Joins' },
      { id: 'node-2', nodeType: 'wait_duration', nodeConfig: { amount: 7, unit: 'days' }, positionX: 300, positionY: 200, label: 'Wait 7 Days' },
      { id: 'node-3', nodeType: 'check_attendance', nodeConfig: { minCount: 1, days: 7 }, positionX: 550, positionY: 200, label: 'Attended?' },
      { id: 'node-4', nodeType: 'add_to_group', nodeConfig: { groupId: 'new-members' }, positionX: 800, positionY: 200, label: 'Add to New Members Group' },
      { id: 'node-5', nodeType: 'wait_duration', nodeConfig: { amount: 30, unit: 'days' }, positionX: 1050, positionY: 200, label: 'Wait 30 Days' },
      { id: 'node-6', nodeType: 'check_engagement', nodeConfig: { level: 'medium' }, positionX: 1300, positionY: 200, label: 'Engagement Check' },
      { id: 'node-7', nodeType: 'send_notification', nodeConfig: { message: 'New member {{firstName}} has low engagement after 30 days' }, positionX: 1550, positionY: 300, label: 'Notify Pastor' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'default' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'true' },
      { fromNodeId: 'node-4', toNodeId: 'node-5', branch: 'default' },
      { fromNodeId: 'node-5', toNodeId: 'node-6', branch: 'default' },
      { fromNodeId: 'node-6', toNodeId: 'node-7', branch: 'false' },
    ],
  },

  // 5. Membership Class Reminder
  {
    name: 'Membership Class Reminder',
    description: 'Reminds new members to attend the membership class. Sends an email invite after 14 days, checks again at 21 days, and creates a pastor task if they still haven\'t attended.',
    category: 'onboarding',
    tags: ['new-member', 'membership-class', 'reminder', 'follow-up'],
    triggerType: 'new_member',
    triggerConfig: {},
    priceCents: 0,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'new_member', nodeConfig: {}, positionX: 50, positionY: 200, label: 'New Member Joins' },
      { id: 'node-2', nodeType: 'wait_duration', nodeConfig: { amount: 14, unit: 'days' }, positionX: 300, positionY: 200, label: 'Wait 14 Days' },
      { id: 'node-3', nodeType: 'check_journey_stage', nodeConfig: { milestone: 'attended_members_class' }, positionX: 550, positionY: 200, label: 'Attended Class?' },
      { id: 'node-4', nodeType: 'send_email', nodeConfig: { subject: 'Join Our Next Membership Class!', body: 'We\'d love for you to attend our membership class! It\'s a great way to learn about our church, meet the pastors, and find your place in our community.' }, positionX: 800, positionY: 300, label: 'Class Invite Email' },
      { id: 'node-5', nodeType: 'wait_duration', nodeConfig: { amount: 7, unit: 'days' }, positionX: 1050, positionY: 300, label: 'Wait 7 Days' },
      { id: 'node-6', nodeType: 'check_journey_stage', nodeConfig: { milestone: 'attended_members_class' }, positionX: 1300, positionY: 300, label: 'Attended Now?' },
      { id: 'node-7', nodeType: 'create_task', nodeConfig: { title: 'Personally invite {{firstName}} to membership class', priority: 'medium', assignedTo: 'pastor' }, positionX: 1550, positionY: 400, label: 'Pastor Task' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'default' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'false' },
      { fromNodeId: 'node-4', toNodeId: 'node-5', branch: 'default' },
      { fromNodeId: 'node-5', toNodeId: 'node-6', branch: 'default' },
      { fromNodeId: 'node-6', toNodeId: 'node-7', branch: 'false' },
    ],
  },

  // ═══════════════════════════════════════════════════
  // ENGAGEMENT (4)
  // ═══════════════════════════════════════════════════

  // 6. Inactive Member Alert
  {
    name: 'Inactive Member Alert',
    description: 'Detects members who have been inactive for 30 days, notifies the pastor, creates a care case, and sends a "we miss you" email after a week.',
    category: 'engagement',
    tags: ['inactive', 'care', 'alert', 'retention'],
    triggerType: 'member_inactive',
    triggerConfig: { days: 30 },
    priceCents: 0,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'member_inactive', nodeConfig: { days: 30 }, positionX: 50, positionY: 200, label: 'Inactive 30 Days' },
      { id: 'node-2', nodeType: 'send_notification', nodeConfig: { message: '{{firstName}} {{lastName}} has been inactive for 30 days' }, positionX: 300, positionY: 200, label: 'Notify Pastor' },
      { id: 'node-3', nodeType: 'create_care_case', nodeConfig: { title: 'Inactive member: {{firstName}} {{lastName}}', priority: 'medium' }, positionX: 550, positionY: 200, label: 'Create Care Case' },
      { id: 'node-4', nodeType: 'wait_duration', nodeConfig: { amount: 7, unit: 'days' }, positionX: 800, positionY: 200, label: 'Wait 7 Days' },
      { id: 'node-5', nodeType: 'send_email', nodeConfig: { subject: 'We miss you, {{firstName}}!', body: 'It\'s been a while since we\'ve seen you and we just wanted you to know you are missed. Our doors are always open and we\'d love to see you this Sunday!' }, positionX: 1050, positionY: 200, label: 'We Miss You Email' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'default' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'default' },
      { fromNodeId: 'node-4', toNodeId: 'node-5', branch: 'default' },
    ],
  },

  // 7. Re-engagement Campaign
  {
    name: 'Re-engagement Campaign',
    description: 'Multi-touch re-engagement for members inactive 60+ days. Sends a personal email, follows up with SMS after 3 days, checks activity after a week, and assigns an "At Risk" tag if still inactive.',
    category: 'engagement',
    tags: ['inactive', 're-engagement', 'email', 'sms', 'at-risk'],
    triggerType: 'member_inactive',
    triggerConfig: { days: 60 },
    priceCents: 200,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'member_inactive', nodeConfig: { days: 60 }, positionX: 50, positionY: 200, label: 'Inactive 60 Days' },
      { id: 'node-2', nodeType: 'send_email', nodeConfig: { subject: 'We\'ve been thinking about you, {{firstName}}', body: 'It has been a while since we connected. Life gets busy, but please know your church family is here for you. Is there anything we can do to help?' }, positionX: 300, positionY: 200, label: 'Personal Email' },
      { id: 'node-3', nodeType: 'wait_duration', nodeConfig: { amount: 3, unit: 'days' }, positionX: 550, positionY: 200, label: 'Wait 3 Days' },
      { id: 'node-4', nodeType: 'send_sms', nodeConfig: { body: 'Hi {{firstName}}, just a quick note from your church family. We miss you and would love to catch up. Feel free to reach out anytime!' }, positionX: 800, positionY: 200, label: 'Follow-up SMS' },
      { id: 'node-5', nodeType: 'wait_duration', nodeConfig: { amount: 7, unit: 'days' }, positionX: 1050, positionY: 200, label: 'Wait 7 Days' },
      { id: 'node-6', nodeType: 'check_attendance', nodeConfig: { minCount: 1, days: 14 }, positionX: 1300, positionY: 200, label: 'Active Now?' },
      { id: 'node-7', nodeType: 'assign_tag', nodeConfig: { tagName: 'At Risk' }, positionX: 1550, positionY: 300, label: 'Tag: At Risk' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'default' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'default' },
      { fromNodeId: 'node-4', toNodeId: 'node-5', branch: 'default' },
      { fromNodeId: 'node-5', toNodeId: 'node-6', branch: 'default' },
      { fromNodeId: 'node-6', toNodeId: 'node-7', branch: 'false' },
    ],
  },

  // 8. Birthday Greeting
  {
    name: 'Birthday Greeting',
    description: 'Runs daily to check for member birthdays and sends a personalized birthday email and push notification.',
    category: 'engagement',
    tags: ['birthday', 'email', 'push', 'personal'],
    triggerType: 'schedule',
    triggerConfig: { cron: 'daily' },
    priceCents: 0,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'schedule', nodeConfig: { cron: 'daily' }, positionX: 50, positionY: 200, label: 'Daily Schedule' },
      { id: 'node-2', nodeType: 'check_date', nodeConfig: { dateField: 'today', operator: 'equals', value: 'birthday' }, positionX: 300, positionY: 200, label: 'Check Birthdays' },
      { id: 'node-3', nodeType: 'send_email', nodeConfig: { subject: 'Happy Birthday, {{firstName}}! 🎂', body: 'Wishing you a blessed and wonderful birthday! Your church family is celebrating with you today.' }, positionX: 550, positionY: 100, label: 'Birthday Email' },
      { id: 'node-4', nodeType: 'send_push', nodeConfig: { title: 'Happy Birthday!', body: 'Your church family wishes you a blessed birthday, {{firstName}}!' }, positionX: 800, positionY: 100, label: 'Birthday Push' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'true' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'default' },
    ],
  },

  // 9. Anniversary Celebration
  {
    name: 'Anniversary Celebration',
    description: 'Runs daily to check for 1-year membership anniversaries. Sends a congratulations email and awards a "1 Year" badge to celebrate the milestone.',
    category: 'engagement',
    tags: ['anniversary', 'badge', 'email', 'milestone'],
    triggerType: 'schedule',
    triggerConfig: { cron: 'daily' },
    priceCents: 200,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'schedule', nodeConfig: { cron: 'daily' }, positionX: 50, positionY: 200, label: 'Daily Schedule' },
      { id: 'node-2', nodeType: 'check_date', nodeConfig: { dateField: 'today', operator: 'equals', value: 'membership_anniversary' }, positionX: 300, positionY: 200, label: 'Check 1-Year Anniversary' },
      { id: 'node-3', nodeType: 'send_email', nodeConfig: { subject: 'Happy 1-Year Anniversary, {{firstName}}!', body: 'It has been one year since you joined our church family! Thank you for being such an important part of our community. We are grateful for you!' }, positionX: 550, positionY: 100, label: 'Anniversary Email' },
      { id: 'node-4', nodeType: 'award_badge', nodeConfig: { badgeId: '1-year-member', reason: 'Celebrating 1 year as a member' }, positionX: 800, positionY: 100, label: 'Award 1-Year Badge' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'true' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'default' },
    ],
  },

  // ═══════════════════════════════════════════════════
  // GIVING (4)
  // ═══════════════════════════════════════════════════

  // 10. First-Time Donor Thank You
  {
    name: 'First-Time Donor Thank You',
    description: 'Detects first-time donations, sends a personal thank-you email, assigns the "Donor" tag, and notifies the pastor about the new giver.',
    category: 'giving',
    tags: ['donation', 'first-time', 'thank-you', 'email'],
    triggerType: 'donation_received',
    triggerConfig: {},
    priceCents: 0,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'donation_received', nodeConfig: {}, positionX: 50, positionY: 200, label: 'Donation Received' },
      { id: 'node-2', nodeType: 'check_giving', nodeConfig: { minAmount: 1, days: 3650 }, positionX: 300, positionY: 200, label: 'First Donation?' },
      { id: 'node-3', nodeType: 'send_email', nodeConfig: { subject: 'Thank You for Your Generous Gift!', body: 'Thank you so much for your first gift to our church! Your generosity makes a real difference in our community. We are truly grateful for your support.' }, positionX: 550, positionY: 100, label: 'Thank-You Email' },
      { id: 'node-4', nodeType: 'assign_tag', nodeConfig: { tagName: 'Donor' }, positionX: 800, positionY: 100, label: 'Tag: Donor' },
      { id: 'node-5', nodeType: 'send_notification', nodeConfig: { message: '{{firstName}} {{lastName}} made their first donation!' }, positionX: 1050, positionY: 100, label: 'Notify Pastor' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'false' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'default' },
      { fromNodeId: 'node-4', toNodeId: 'node-5', branch: 'default' },
    ],
  },

  // 11. Giving Milestone Badges
  {
    name: 'Giving Milestone Badges',
    description: 'Automatically checks badge eligibility after each donation. If a new badge is earned, sends a congratulations push notification and notifies the pastor.',
    category: 'giving',
    tags: ['donation', 'badge', 'milestone', 'push'],
    triggerType: 'donation_received',
    triggerConfig: {},
    priceCents: 200,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'donation_received', nodeConfig: {}, positionX: 50, positionY: 200, label: 'Donation Received' },
      { id: 'node-2', nodeType: 'check_auto_badges', nodeConfig: {}, positionX: 300, positionY: 200, label: 'Check Badge Rules' },
      { id: 'node-3', nodeType: 'send_push', nodeConfig: { title: 'Congratulations!', body: 'You earned a new giving badge! Check your profile to see it.' }, positionX: 550, positionY: 200, label: 'Badge Push' },
      { id: 'node-4', nodeType: 'send_notification', nodeConfig: { message: '{{firstName}} earned a new giving milestone badge' }, positionX: 800, positionY: 200, label: 'Notify Pastor' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'default' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'default' },
    ],
  },

  // 12. Recurring Giving Follow-Up
  {
    name: 'Recurring Giving Follow-Up',
    description: 'After a donation is received, checks if the donor has a recurring gift set up. If not, waits 30 days and sends a gentle email about the benefits of recurring giving.',
    category: 'giving',
    tags: ['donation', 'recurring', 'follow-up', 'email'],
    triggerType: 'donation_received',
    triggerConfig: {},
    priceCents: 0,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'donation_received', nodeConfig: {}, positionX: 50, positionY: 200, label: 'Donation Received' },
      { id: 'node-2', nodeType: 'check_tag', nodeConfig: { tagId: 'recurring-donor' }, positionX: 300, positionY: 200, label: 'Has Recurring?' },
      { id: 'node-3', nodeType: 'wait_duration', nodeConfig: { amount: 30, unit: 'days' }, positionX: 550, positionY: 300, label: 'Wait 30 Days' },
      { id: 'node-4', nodeType: 'send_email', nodeConfig: { subject: 'Make an Even Greater Impact', body: 'Thank you for your generosity! Did you know you can set up recurring giving to make an even bigger impact? Recurring gifts help us plan ahead and serve our community consistently.' }, positionX: 800, positionY: 300, label: 'Recurring Giving Email' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'false' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'default' },
    ],
  },

  // 13. Year-End Giving Summary
  {
    name: 'Year-End Giving Summary',
    description: 'Runs at the end of December to generate a giving report and email it to all donors as their annual giving summary for tax purposes.',
    category: 'giving',
    tags: ['giving', 'report', 'year-end', 'tax'],
    triggerType: 'schedule',
    triggerConfig: { cron: 'monthly_last' },
    priceCents: 200,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'schedule', nodeConfig: { cron: 'monthly_last' }, positionX: 50, positionY: 200, label: 'End of December' },
      { id: 'node-2', nodeType: 'check_date', nodeConfig: { dateField: 'today', operator: 'equals', value: 'december' }, positionX: 300, positionY: 200, label: 'Is December?' },
      { id: 'node-3', nodeType: 'generate_report', nodeConfig: { reportType: 'giving', sendTo: 'all_donors' }, positionX: 550, positionY: 100, label: 'Generate Giving Report' },
      { id: 'node-4', nodeType: 'send_email', nodeConfig: { subject: 'Your {{year}} Giving Summary', body: 'Thank you for your generous support throughout the year! Attached is your annual giving summary for your records.' }, positionX: 800, positionY: 100, label: 'Email to Donors' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'true' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'default' },
    ],
  },

  // ═══════════════════════════════════════════════════
  // CARE (3)
  // ═══════════════════════════════════════════════════

  // 14. Urgent Care Case Escalation
  {
    name: 'Urgent Care Case Escalation',
    description: 'When an urgent care case is created, immediately sends a push notification to all pastors and creates a high-priority task for the lead pastor due today.',
    category: 'care',
    tags: ['care', 'urgent', 'escalation', 'push', 'task'],
    triggerType: 'care_case_created',
    triggerConfig: {},
    priceCents: 0,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'care_case_created', nodeConfig: {}, positionX: 50, positionY: 200, label: 'Care Case Created' },
      { id: 'node-2', nodeType: 'check_member_data', nodeConfig: { field: 'role', operator: 'equals', value: 'urgent' }, positionX: 300, positionY: 200, label: 'Is Urgent?' },
      { id: 'node-3', nodeType: 'send_push', nodeConfig: { title: 'URGENT Care Case', body: 'An urgent care case has been created and needs immediate attention.' }, positionX: 550, positionY: 100, label: 'Push to Pastors' },
      { id: 'node-4', nodeType: 'create_task', nodeConfig: { title: 'URGENT: Respond to care case for {{firstName}}', priority: 'urgent', assignedTo: 'lead_pastor' }, positionX: 800, positionY: 100, label: 'Lead Pastor Task' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'true' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'default' },
    ],
  },

  // 15. Care Case Follow-Up Reminder
  {
    name: 'Care Case Follow-Up Reminder',
    description: 'After a care case is created, waits 7 days and checks if it\'s resolved. Sends a reminder to the assigned pastor if not, and escalates to the lead pastor after another 7 days.',
    category: 'care',
    tags: ['care', 'follow-up', 'reminder', 'escalation'],
    triggerType: 'care_case_created',
    triggerConfig: {},
    priceCents: 200,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'care_case_created', nodeConfig: {}, positionX: 50, positionY: 200, label: 'Care Case Created' },
      { id: 'node-2', nodeType: 'wait_duration', nodeConfig: { amount: 7, unit: 'days' }, positionX: 300, positionY: 200, label: 'Wait 7 Days' },
      { id: 'node-3', nodeType: 'check_tag', nodeConfig: { tagId: 'care-resolved' }, positionX: 550, positionY: 200, label: 'Resolved?' },
      { id: 'node-4', nodeType: 'send_notification', nodeConfig: { message: 'Reminder: Care case for {{firstName}} is still open after 7 days' }, positionX: 800, positionY: 300, label: 'Remind Pastor' },
      { id: 'node-5', nodeType: 'wait_duration', nodeConfig: { amount: 7, unit: 'days' }, positionX: 1050, positionY: 300, label: 'Wait 7 More Days' },
      { id: 'node-6', nodeType: 'check_tag', nodeConfig: { tagId: 'care-resolved' }, positionX: 1300, positionY: 300, label: 'Resolved Now?' },
      { id: 'node-7', nodeType: 'create_task', nodeConfig: { title: 'ESCALATION: Care case for {{firstName}} open 14+ days', priority: 'high', assignedTo: 'lead_pastor' }, positionX: 1550, positionY: 400, label: 'Escalate to Lead Pastor' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'default' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'false' },
      { fromNodeId: 'node-4', toNodeId: 'node-5', branch: 'default' },
      { fromNodeId: 'node-5', toNodeId: 'node-6', branch: 'default' },
      { fromNodeId: 'node-6', toNodeId: 'node-7', branch: 'false' },
    ],
  },

  // 16. Prayer Request Follow-Up
  {
    name: 'Prayer Request Follow-Up',
    description: 'After a prayer request is submitted, waits 14 days and checks if it has been marked as answered. If not, sends an encouragement email to the requester.',
    category: 'care',
    tags: ['prayer', 'follow-up', 'encouragement', 'email'],
    triggerType: 'prayer_created',
    triggerConfig: {},
    priceCents: 0,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'prayer_created', nodeConfig: {}, positionX: 50, positionY: 200, label: 'Prayer Request Created' },
      { id: 'node-2', nodeType: 'wait_duration', nodeConfig: { amount: 14, unit: 'days' }, positionX: 300, positionY: 200, label: 'Wait 14 Days' },
      { id: 'node-3', nodeType: 'check_tag', nodeConfig: { tagId: 'prayer-answered' }, positionX: 550, positionY: 200, label: 'Answered?' },
      { id: 'node-4', nodeType: 'send_email', nodeConfig: { subject: 'We\'re Still Praying For You', body: 'We wanted you to know that your prayer request is still on our hearts. God is faithful, and we continue to lift you up in prayer. Please don\'t hesitate to reach out if you need anything.' }, positionX: 800, positionY: 300, label: 'Encouragement Email' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'default' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'false' },
    ],
  },

  // ═══════════════════════════════════════════════════
  // EVENTS (2)
  // ═══════════════════════════════════════════════════

  // 17. Event Reminder Flow
  {
    name: 'Event Reminder Flow',
    description: 'After an event RSVP, sends a reminder email and push notification 1 day before the event, then a "See you today!" SMS on the day of the event.',
    category: 'events',
    tags: ['event', 'rsvp', 'reminder', 'email', 'sms', 'push'],
    triggerType: 'event_rsvp',
    triggerConfig: {},
    priceCents: 0,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'event_rsvp', nodeConfig: {}, positionX: 50, positionY: 200, label: 'Event RSVP' },
      { id: 'node-2', nodeType: 'wait_duration', nodeConfig: { amount: 1, unit: 'days' }, positionX: 300, positionY: 200, label: 'Wait Until Day Before' },
      { id: 'node-3', nodeType: 'send_email', nodeConfig: { subject: 'Reminder: {{eventName}} is Tomorrow!', body: 'Just a friendly reminder that {{eventName}} is happening tomorrow! We can\'t wait to see you there.' }, positionX: 550, positionY: 200, label: 'Reminder Email' },
      { id: 'node-4', nodeType: 'send_push', nodeConfig: { title: 'Event Tomorrow!', body: '{{eventName}} is tomorrow. Don\'t forget!' }, positionX: 800, positionY: 200, label: 'Reminder Push' },
      { id: 'node-5', nodeType: 'wait_duration', nodeConfig: { amount: 1, unit: 'days' }, positionX: 1050, positionY: 200, label: 'Wait Until Event Day' },
      { id: 'node-6', nodeType: 'send_sms', nodeConfig: { body: 'See you today at {{eventName}}! We are excited to have you.' }, positionX: 1300, positionY: 200, label: 'Day-Of SMS' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'default' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'default' },
      { fromNodeId: 'node-4', toNodeId: 'node-5', branch: 'default' },
      { fromNodeId: 'node-5', toNodeId: 'node-6', branch: 'default' },
    ],
  },

  // 18. Post-Event Follow-Up
  {
    name: 'Post-Event Follow-Up',
    description: 'After a check-in at an event, waits 1 day and sends a thank-you email. Assigns an "Event Attendee" tag to the member for tracking.',
    category: 'events',
    tags: ['event', 'check-in', 'follow-up', 'email', 'tag'],
    triggerType: 'check_in',
    triggerConfig: {},
    priceCents: 0,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'check_in', nodeConfig: {}, positionX: 50, positionY: 200, label: 'Event Check-In' },
      { id: 'node-2', nodeType: 'wait_duration', nodeConfig: { amount: 1, unit: 'days' }, positionX: 300, positionY: 200, label: 'Wait 1 Day' },
      { id: 'node-3', nodeType: 'send_email', nodeConfig: { subject: 'Thanks for Joining Us!', body: 'Thank you for attending! We hope you had a great time. We would love to see you at our next event or service.' }, positionX: 550, positionY: 200, label: 'Thank-You Email' },
      { id: 'node-4', nodeType: 'assign_tag', nodeConfig: { tagName: 'Event Attendee' }, positionX: 800, positionY: 200, label: 'Tag: Event Attendee' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'default' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'default' },
    ],
  },

  // ═══════════════════════════════════════════════════
  // VOLUNTEERS (2)
  // ═══════════════════════════════════════════════════

  // 19. Volunteer Onboarding
  {
    name: 'Volunteer Onboarding',
    description: 'Manual trigger for onboarding new volunteers. Sends a welcome email, adds them to the Volunteers group, assigns a tag, and creates a task for the team leader to meet with them.',
    category: 'volunteers',
    tags: ['volunteer', 'onboarding', 'email', 'group', 'task'],
    triggerType: 'manual',
    triggerConfig: {},
    priceCents: 0,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'manual', nodeConfig: {}, positionX: 50, positionY: 200, label: 'Manual Trigger' },
      { id: 'node-2', nodeType: 'send_email', nodeConfig: { subject: 'Welcome to the Volunteer Team!', body: 'Thank you for stepping up to serve! We are thrilled to have you on the team. Your team leader will be reaching out soon to get you connected.' }, positionX: 300, positionY: 200, label: 'Welcome Email' },
      { id: 'node-3', nodeType: 'add_to_group', nodeConfig: { groupId: 'volunteers' }, positionX: 550, positionY: 200, label: 'Add to Volunteers Group' },
      { id: 'node-4', nodeType: 'assign_tag', nodeConfig: { tagName: 'Volunteer' }, positionX: 800, positionY: 200, label: 'Tag: Volunteer' },
      { id: 'node-5', nodeType: 'create_task', nodeConfig: { title: 'Meet with new volunteer {{firstName}} {{lastName}}', priority: 'medium', assignedTo: 'team_leader' }, positionX: 1050, positionY: 200, label: 'Team Leader Task' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'default' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'default' },
      { fromNodeId: 'node-4', toNodeId: 'node-5', branch: 'default' },
    ],
  },

  // 20. Volunteer Hour Milestone
  {
    name: 'Volunteer Hour Milestone',
    description: 'Runs weekly to check volunteer hours. Awards "Dedicated Servant" badge at 50+ hours and "Ministry Champion" badge at 100+ hours.',
    category: 'volunteers',
    tags: ['volunteer', 'hours', 'milestone', 'badge'],
    triggerType: 'schedule',
    triggerConfig: { cron: 'weekly_monday' },
    priceCents: 200,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'schedule', nodeConfig: { cron: 'weekly_monday' }, positionX: 50, positionY: 200, label: 'Weekly Check' },
      { id: 'node-2', nodeType: 'check_member_data', nodeConfig: { field: 'role', operator: 'exists', value: 'volunteer_hours_50' }, positionX: 300, positionY: 200, label: '50+ Hours?' },
      { id: 'node-3', nodeType: 'award_badge', nodeConfig: { badgeId: 'dedicated-servant', reason: '50+ volunteer hours' }, positionX: 550, positionY: 100, label: 'Dedicated Servant Badge' },
      { id: 'node-4', nodeType: 'check_member_data', nodeConfig: { field: 'role', operator: 'exists', value: 'volunteer_hours_100' }, positionX: 800, positionY: 100, label: '100+ Hours?' },
      { id: 'node-5', nodeType: 'award_badge', nodeConfig: { badgeId: 'ministry-champion', reason: '100+ volunteer hours' }, positionX: 1050, positionY: 50, label: 'Ministry Champion Badge' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'true' },
      { fromNodeId: 'node-3', toNodeId: 'node-4', branch: 'default' },
      { fromNodeId: 'node-4', toNodeId: 'node-5', branch: 'true' },
    ],
  },

  // ═══════════════════════════════════════════════════
  // COMMUNICATIONS (2)
  // ═══════════════════════════════════════════════════

  // 21. Weekly Digest
  {
    name: 'Weekly Digest',
    description: 'Runs every Monday morning to generate an engagement report and email it to all pastors for their weekly review.',
    category: 'communications',
    tags: ['weekly', 'report', 'engagement', 'email', 'pastors'],
    triggerType: 'schedule',
    triggerConfig: { cron: 'weekly_monday' },
    priceCents: 0,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'schedule', nodeConfig: { cron: 'weekly_monday' }, positionX: 50, positionY: 200, label: 'Every Monday' },
      { id: 'node-2', nodeType: 'generate_report', nodeConfig: { reportType: 'engagement', sendTo: 'pastors' }, positionX: 300, positionY: 200, label: 'Generate Engagement Report' },
      { id: 'node-3', nodeType: 'send_email', nodeConfig: { subject: 'Weekly Church Engagement Digest', body: 'Here is your weekly engagement summary. Review the report attached for insights on member activity, attendance trends, and areas needing attention.' }, positionX: 550, positionY: 200, label: 'Email to Pastors' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-3', branch: 'default' },
    ],
  },

  // 22. Monthly Dashboard Report
  {
    name: 'Monthly Dashboard Report',
    description: 'Runs on the first of every month to generate giving, attendance, and membership reports, then emails a comprehensive dashboard to the admin team.',
    category: 'communications',
    tags: ['monthly', 'report', 'dashboard', 'giving', 'attendance'],
    triggerType: 'schedule',
    triggerConfig: { cron: 'monthly_first' },
    priceCents: 200,
    isOfficial: true,
    nodes: [
      { id: 'node-1', nodeType: 'schedule', nodeConfig: { cron: 'monthly_first' }, positionX: 50, positionY: 200, label: 'First of Month' },
      { id: 'node-2', nodeType: 'generate_report', nodeConfig: { reportType: 'giving', sendTo: 'admin' }, positionX: 300, positionY: 100, label: 'Giving Report' },
      { id: 'node-3', nodeType: 'generate_report', nodeConfig: { reportType: 'attendance', sendTo: 'admin' }, positionX: 300, positionY: 200, label: 'Attendance Report' },
      { id: 'node-4', nodeType: 'generate_report', nodeConfig: { reportType: 'members', sendTo: 'admin' }, positionX: 300, positionY: 300, label: 'Members Report' },
      { id: 'node-5', nodeType: 'send_email', nodeConfig: { subject: 'Monthly Church Dashboard - {{month}} {{year}}', body: 'Here is your monthly church dashboard with giving, attendance, and membership reports. Review the attached reports for a comprehensive overview of your church health.' }, positionX: 550, positionY: 200, label: 'Dashboard Email' },
    ],
    connections: [
      { fromNodeId: 'node-1', toNodeId: 'node-2', branch: 'default' },
      { fromNodeId: 'node-1', toNodeId: 'node-3', branch: 'default' },
      { fromNodeId: 'node-1', toNodeId: 'node-4', branch: 'default' },
      { fromNodeId: 'node-2', toNodeId: 'node-5', branch: 'default' },
      { fromNodeId: 'node-3', toNodeId: 'node-5', branch: 'default' },
      { fromNodeId: 'node-4', toNodeId: 'node-5', branch: 'default' },
    ],
  },
];
