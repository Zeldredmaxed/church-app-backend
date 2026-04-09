/**
 * All available node types for the workflow builder.
 * Each node type has a category, config schema, and execution logic.
 */

// ─── TRIGGER TYPES ───
// These start a workflow. Only one trigger per workflow.
export const TRIGGER_TYPES = [
  'new_member',
  'member_tagged',
  'check_in',
  'donation_received',
  'event_rsvp',
  'prayer_created',
  'group_joined',
  'care_case_created',
  'task_completed',
  'form_submitted',
  'schedule',
  'date_reached',
  'manual',
  'workflow_completed',
  'member_inactive',
  'baptism_completed',
  'members_class_completed',
  'inbound_webhook',         // Receives data from external services via POST
] as const;

// ─── ACTION TYPES ───
// These do something when executed.
export const ACTION_TYPES = [
  'send_email',
  'send_sms',
  'send_push',
  'send_notification',
  'create_task',
  'create_care_case',
  'assign_tag',
  'remove_tag',
  'add_to_group',
  'remove_from_group',
  'update_journey',
  'update_member_role',
  'generate_report',
  'trigger_workflow',
  'webhook',
  'log_activity',
] as const;

// ─── CONDITION TYPES ───
// These branch the flow based on data.
export const CONDITION_TYPES = [
  'check_member_data',
  'check_date',
  'check_giving',
  'check_attendance',
  'check_group_membership',
  'check_tag',
  'check_engagement',
  'check_journey_stage',
  'always_true',
] as const;

// ─── DELAY TYPES ───
// These pause execution for a period.
export const DELAY_TYPES = [
  'wait_duration',
  'wait_until_date',
  'wait_until_day',
] as const;

// ─── FILTER TYPES ───
// These filter which members continue through the flow.
export const FILTER_TYPES = [
  'filter_by_tag',
  'filter_by_role',
  'filter_by_group',
] as const;

export const ALL_NODE_TYPES = [
  ...TRIGGER_TYPES,
  ...ACTION_TYPES,
  ...CONDITION_TYPES,
  ...DELAY_TYPES,
  ...FILTER_TYPES,
] as const;

export type TriggerType = typeof TRIGGER_TYPES[number];
export type ActionType = typeof ACTION_TYPES[number];
export type ConditionType = typeof CONDITION_TYPES[number];
export type DelayType = typeof DELAY_TYPES[number];
export type FilterType = typeof FILTER_TYPES[number];
export type NodeType = typeof ALL_NODE_TYPES[number];

/**
 * Node type metadata for the frontend builder.
 * The frontend uses this to render the node palette.
 */
export interface NodeTypeInfo {
  type: string;
  category: 'trigger' | 'action' | 'condition' | 'delay' | 'filter';
  label: string;
  description: string;
  icon: string;
  color: string;
  configFields: Array<{
    key: string;
    label: string;
    type: 'text' | 'number' | 'select' | 'boolean' | 'date' | 'member' | 'tag' | 'group' | 'template' | 'workflow';
    options?: string[];
    required?: boolean;
    placeholder?: string;
  }>;
}

export const NODE_TYPE_REGISTRY: NodeTypeInfo[] = [
  // TRIGGERS
  { type: 'new_member', category: 'trigger', label: 'New Member Joins', description: 'Triggers when someone joins your church', icon: 'UserPlus', color: 'emerald', configFields: [] },
  { type: 'member_tagged', category: 'trigger', label: 'Member Tagged', description: 'Triggers when a tag is assigned', icon: 'Tag', color: 'emerald', configFields: [{ key: 'tagId', label: 'Tag', type: 'tag', required: false, placeholder: 'Any tag' }] },
  { type: 'check_in', category: 'trigger', label: 'Member Checks In', description: 'Triggers on service check-in', icon: 'CheckCircle', color: 'emerald', configFields: [{ key: 'serviceId', label: 'Service', type: 'select', required: false, placeholder: 'Any service' }] },
  { type: 'donation_received', category: 'trigger', label: 'Donation Received', description: 'Triggers when a donation succeeds', icon: 'DollarSign', color: 'emerald', configFields: [{ key: 'minAmount', label: 'Min Amount', type: 'number', required: false, placeholder: 'Any amount' }] },
  { type: 'event_rsvp', category: 'trigger', label: 'Event RSVP', description: 'Triggers when someone RSVPs', icon: 'Calendar', color: 'emerald', configFields: [{ key: 'eventId', label: 'Event', type: 'select', required: false, placeholder: 'Any event' }] },
  { type: 'prayer_created', category: 'trigger', label: 'Prayer Request', description: 'Triggers on new prayer request', icon: 'Heart', color: 'emerald', configFields: [] },
  { type: 'group_joined', category: 'trigger', label: 'Group Joined', description: 'Triggers when member joins a group', icon: 'Users', color: 'emerald', configFields: [{ key: 'groupId', label: 'Group', type: 'group', required: false, placeholder: 'Any group' }] },
  { type: 'care_case_created', category: 'trigger', label: 'Care Case Created', description: 'Triggers on new pastoral care case', icon: 'HeartHandshake', color: 'emerald', configFields: [] },
  { type: 'task_completed', category: 'trigger', label: 'Task Completed', description: 'Triggers when a task is done', icon: 'CheckSquare', color: 'emerald', configFields: [] },
  { type: 'form_submitted', category: 'trigger', label: 'Form Submitted', description: 'Triggers when a form is submitted', icon: 'FileText', color: 'emerald', configFields: [] },
  { type: 'schedule', category: 'trigger', label: 'On Schedule', description: 'Runs on a recurring schedule', icon: 'Clock', color: 'emerald', configFields: [{ key: 'cron', label: 'Schedule', type: 'select', options: ['daily', 'weekly_monday', 'weekly_sunday', 'monthly_first', 'monthly_last'], required: true }] },
  { type: 'date_reached', category: 'trigger', label: 'Date Reached', description: 'Fires on a specific date', icon: 'CalendarDays', color: 'emerald', configFields: [{ key: 'date', label: 'Date', type: 'date', required: true }] },
  { type: 'manual', category: 'trigger', label: 'Manual Trigger', description: 'Triggered by admin', icon: 'Play', color: 'emerald', configFields: [] },
  { type: 'workflow_completed', category: 'trigger', label: 'Workflow Completed', description: 'Chains from another workflow', icon: 'GitBranch', color: 'emerald', configFields: [{ key: 'workflowId', label: 'Workflow', type: 'workflow', required: true }] },
  { type: 'member_inactive', category: 'trigger', label: 'Member Inactive', description: 'Fires when inactive for X days', icon: 'UserX', color: 'emerald', configFields: [{ key: 'days', label: 'Days inactive', type: 'number', required: true, placeholder: '30' }] },
  { type: 'baptism_completed', category: 'trigger', label: 'Baptism Completed', description: 'Fires when member is baptized', icon: 'Droplets', color: 'emerald', configFields: [] },
  { type: 'members_class_completed', category: 'trigger', label: 'Members Class Done', description: 'Fires when members class is completed', icon: 'GraduationCap', color: 'emerald', configFields: [] },
  { type: 'inbound_webhook', category: 'trigger', label: 'Receive Webhook', description: 'Receives data from an external service via POST', icon: 'Webhook', color: 'emerald', configFields: [{ key: 'secret', label: 'Webhook Secret (optional)', type: 'text', required: false, placeholder: 'For signature verification' }] },

  // ACTIONS
  { type: 'send_email', category: 'action', label: 'Send Email', description: 'Send an email to the member', icon: 'Mail', color: 'blue', configFields: [{ key: 'subject', label: 'Subject', type: 'text', required: true }, { key: 'body', label: 'Body', type: 'text', required: true }, { key: 'templateId', label: 'Or use template', type: 'template', required: false }] },
  { type: 'send_sms', category: 'action', label: 'Send SMS', description: 'Send a text message', icon: 'MessageSquare', color: 'blue', configFields: [{ key: 'body', label: 'Message', type: 'text', required: true }] },
  { type: 'send_push', category: 'action', label: 'Push Notification', description: 'Send a push notification', icon: 'Bell', color: 'blue', configFields: [{ key: 'title', label: 'Title', type: 'text', required: true }, { key: 'body', label: 'Body', type: 'text', required: true }] },
  { type: 'send_notification', category: 'action', label: 'In-App Notification', description: 'Create in-app notification', icon: 'BellRing', color: 'blue', configFields: [{ key: 'message', label: 'Message', type: 'text', required: true }] },
  { type: 'create_task', category: 'action', label: 'Create Task', description: 'Auto-create a task', icon: 'ListTodo', color: 'blue', configFields: [{ key: 'title', label: 'Title', type: 'text', required: true }, { key: 'assignedTo', label: 'Assign to', type: 'member', required: false }, { key: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high', 'urgent'] }] },
  { type: 'create_care_case', category: 'action', label: 'Create Care Case', description: 'Open a pastoral care case', icon: 'HeartHandshake', color: 'blue', configFields: [{ key: 'title', label: 'Title', type: 'text', required: true }, { key: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high', 'urgent'] }] },
  { type: 'assign_tag', category: 'action', label: 'Assign Tag', description: 'Add a tag to the member', icon: 'TagIcon', color: 'blue', configFields: [{ key: 'tagId', label: 'Tag', type: 'tag', required: true }] },
  { type: 'remove_tag', category: 'action', label: 'Remove Tag', description: 'Remove a tag from the member', icon: 'X', color: 'blue', configFields: [{ key: 'tagId', label: 'Tag', type: 'tag', required: true }] },
  { type: 'add_to_group', category: 'action', label: 'Add to Group', description: 'Add member to a group', icon: 'UserPlus', color: 'blue', configFields: [{ key: 'groupId', label: 'Group', type: 'group', required: true }] },
  { type: 'remove_from_group', category: 'action', label: 'Remove from Group', description: 'Remove from a group', icon: 'UserMinus', color: 'blue', configFields: [{ key: 'groupId', label: 'Group', type: 'group', required: true }] },
  { type: 'update_journey', category: 'action', label: 'Update Journey', description: 'Update spiritual journey', icon: 'Milestone', color: 'blue', configFields: [{ key: 'field', label: 'Field', type: 'select', options: ['attended_members_class', 'is_baptized', 'discipleship_track'], required: true }, { key: 'value', label: 'Value', type: 'text', required: true }] },
  { type: 'update_member_role', category: 'action', label: 'Change Role', description: 'Change member role', icon: 'Shield', color: 'blue', configFields: [{ key: 'role', label: 'New Role', type: 'select', options: ['admin', 'pastor', 'accountant', 'worship_leader', 'member'], required: true }] },
  { type: 'generate_report', category: 'action', label: 'Generate Report', description: 'Generate and email a report', icon: 'FileBarChart', color: 'blue', configFields: [{ key: 'reportType', label: 'Report', type: 'select', options: ['giving', 'attendance', 'members', 'engagement'], required: true }, { key: 'sendTo', label: 'Email to', type: 'text', required: true }] },
  { type: 'trigger_workflow', category: 'action', label: 'Start Workflow', description: 'Trigger another workflow', icon: 'GitBranch', color: 'blue', configFields: [{ key: 'workflowId', label: 'Workflow', type: 'workflow', required: true }] },
  { type: 'webhook', category: 'action', label: 'Call Webhook', description: 'POST to an external URL', icon: 'Globe', color: 'blue', configFields: [{ key: 'url', label: 'URL', type: 'text', required: true }, { key: 'headers', label: 'Headers (JSON)', type: 'text', required: false }] },
  { type: 'log_activity', category: 'action', label: 'Log Activity', description: 'Record a custom note', icon: 'FileText', color: 'blue', configFields: [{ key: 'message', label: 'Message', type: 'text', required: true }] },

  // CONDITIONS
  { type: 'check_member_data', category: 'condition', label: 'Check Member', description: 'Branch on member data', icon: 'GitFork', color: 'amber', configFields: [{ key: 'field', label: 'Field', type: 'select', options: ['role', 'has_phone', 'has_email', 'full_name'], required: true }, { key: 'operator', label: 'Operator', type: 'select', options: ['equals', 'not_equals', 'exists', 'not_exists'], required: true }, { key: 'value', label: 'Value', type: 'text', required: false }] },
  { type: 'check_date', category: 'condition', label: 'Check Date', description: 'Branch on date comparison', icon: 'Calendar', color: 'amber', configFields: [{ key: 'dateField', label: 'Date Field', type: 'select', options: ['today', 'day_of_week'], required: true }, { key: 'operator', label: 'Operator', type: 'select', options: ['equals', 'before', 'after'], required: true }, { key: 'value', label: 'Value', type: 'text', required: true }] },
  { type: 'check_tag', category: 'condition', label: 'Has Tag?', description: 'Check if member has a tag', icon: 'Tag', color: 'amber', configFields: [{ key: 'tagId', label: 'Tag', type: 'tag', required: true }] },
  { type: 'check_attendance', category: 'condition', label: 'Attendance Check', description: 'Check attendance frequency', icon: 'CheckCircle', color: 'amber', configFields: [{ key: 'minCount', label: 'Min check-ins', type: 'number', required: true }, { key: 'days', label: 'In last N days', type: 'number', required: true }] },
  { type: 'check_giving', category: 'condition', label: 'Giving Check', description: 'Check giving amount', icon: 'DollarSign', color: 'amber', configFields: [{ key: 'minAmount', label: 'Min amount', type: 'number', required: true }, { key: 'days', label: 'In last N days', type: 'number', required: true }] },
  { type: 'check_group_membership', category: 'condition', label: 'In Group?', description: 'Check group membership', icon: 'Users', color: 'amber', configFields: [{ key: 'groupId', label: 'Group', type: 'group', required: true }] },
  { type: 'check_engagement', category: 'condition', label: 'Engagement Level', description: 'Check engagement score', icon: 'Activity', color: 'amber', configFields: [{ key: 'level', label: 'Min Level', type: 'select', options: ['inactive', 'low', 'medium', 'high'], required: true }] },
  { type: 'check_journey_stage', category: 'condition', label: 'Journey Stage', description: 'Check spiritual milestone', icon: 'Milestone', color: 'amber', configFields: [{ key: 'milestone', label: 'Milestone', type: 'select', options: ['attended_members_class', 'is_baptized', 'salvation_date', 'discipleship_foundations', 'discipleship_growth', 'discipleship_leadership', 'discipleship_completed'], required: true }] },
  { type: 'always_true', category: 'condition', label: 'Always True', description: 'Always takes the true branch', icon: 'Check', color: 'amber', configFields: [] },

  // DELAYS
  { type: 'wait_duration', category: 'delay', label: 'Wait', description: 'Pause for a duration', icon: 'Timer', color: 'purple', configFields: [{ key: 'amount', label: 'Amount', type: 'number', required: true }, { key: 'unit', label: 'Unit', type: 'select', options: ['minutes', 'hours', 'days', 'weeks'], required: true }] },
  { type: 'wait_until_date', category: 'delay', label: 'Wait Until Date', description: 'Pause until a specific date', icon: 'CalendarClock', color: 'purple', configFields: [{ key: 'date', label: 'Date', type: 'date', required: true }] },
  { type: 'wait_until_day', category: 'delay', label: 'Wait Until Day', description: 'Pause until next specific day', icon: 'CalendarDays', color: 'purple', configFields: [{ key: 'dayOfWeek', label: 'Day', type: 'select', options: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], required: true }] },

  // FILTERS
  { type: 'filter_by_tag', category: 'filter', label: 'Filter by Tag', description: 'Only continue if member has tag', icon: 'Filter', color: 'rose', configFields: [{ key: 'tagId', label: 'Tag', type: 'tag', required: true }] },
  { type: 'filter_by_role', category: 'filter', label: 'Filter by Role', description: 'Only continue if member has role', icon: 'Filter', color: 'rose', configFields: [{ key: 'role', label: 'Role', type: 'select', options: ['admin', 'pastor', 'accountant', 'worship_leader', 'member'], required: true }] },
  { type: 'filter_by_group', category: 'filter', label: 'Filter by Group', description: 'Only continue if in group', icon: 'Filter', color: 'rose', configFields: [{ key: 'groupId', label: 'Group', type: 'group', required: true }] },
];
