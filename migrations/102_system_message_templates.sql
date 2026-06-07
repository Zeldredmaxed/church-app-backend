-- 102: System message templates (shared across all tenants)
--
-- Pre-seeds 15 starter email/SMS templates that any tenant's workflow
-- send_email / send_sms nodes can pick from the dropdown. Without
-- this, a brand-new tenant sees "Select Template" with an empty list.
--
-- Design: message_templates.tenant_id becomes nullable.
--   NULL  = system template (read-only, shown to every tenant)
--   UUID  = tenant-owned (existing behavior, full CRUD)
--
-- Pickers should UNION the system templates with the tenant's own.

-- 1. Allow nullable tenant_id for system templates.
ALTER TABLE public.message_templates
  ALTER COLUMN tenant_id DROP NOT NULL;

-- 2. created_by also becomes nullable for system templates
--    (no human authored them — the migration seeds them).
ALTER TABLE public.message_templates
  ALTER COLUMN created_by DROP NOT NULL;

-- 3. Mark system templates with is_system. Lets the picker grey-out
--    the edit button and prevents tenants from modifying shared text.
ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

-- 4. RLS update: SELECT visible if (tenant matches) OR (is_system = true).
DROP POLICY IF EXISTS "message_templates: select within tenant" ON public.message_templates;
DROP POLICY IF EXISTS "message_templates: select own or system" ON public.message_templates;
CREATE POLICY "message_templates: select own or system"
  ON public.message_templates FOR SELECT
  USING (
    is_system = true
    OR tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

-- Tenant-owned write policies stay as-is (RLS already gates by
-- tenant_id; system rows have tenant_id NULL so no tenant matches —
-- they're read-only to all tenants by construction).

-- 5. Seed 15 system templates covering the most common workflow
--    send_email / send_sms patterns. All use {{firstName}},
--    {{churchName}} merge fields the workflow engine resolves.

INSERT INTO public.message_templates (tenant_id, name, subject, body, channel, is_system)
VALUES
  -- ─── Email templates ───
  (NULL, 'Welcome — New Member', 'Welcome to {{churchName}}, {{firstName}}!',
   E'Hi {{firstName}},\n\nWe are so glad you have joined our {{churchName}} family. Here are a few ways to get connected this week:\n\n• Join us for service this Sunday\n• Sign up for a small group at our welcome desk\n• Reach out anytime by replying to this email\n\nIn Christ,\n{{churchName}} Team',
   'email', true),

  (NULL, 'First-Time Visitor Thank You', 'Thank you for visiting {{churchName}}',
   E'Hi {{firstName}},\n\nIt was a joy to have you with us today. We hope you felt welcomed.\n\nIf you have any questions or would like to learn more about our church, just reply to this email — we''d love to hear from you.\n\nBlessings,\n{{churchName}}',
   'email', true),

  (NULL, 'Birthday Greeting', 'Happy birthday, {{firstName}}!',
   E'Happy birthday, {{firstName}}!\n\nThe {{churchName}} family is praying for a year of joy, purpose, and growth ahead. May God bless you abundantly.\n\nIn Christ,\nYour {{churchName}} Family',
   'email', true),

  (NULL, 'Re-engagement — Missed You', 'We''ve missed you at {{churchName}}, {{firstName}}',
   E'Hi {{firstName}},\n\nWe haven''t seen you in a while and just wanted to reach out. No pressure — life gets busy. But if there''s anything going on that we can pray for or help with, please let us know.\n\nWe''d love to see you this Sunday.\n\nWith love,\n{{churchName}}',
   'email', true),

  (NULL, 'Volunteer Thank You', 'Thank you for serving, {{firstName}}',
   E'Hi {{firstName}},\n\nThank you for your faithful service to {{churchName}}. Your time and heart make a real difference in our community, and we are deeply grateful.\n\n"Whatever you do, work at it with all your heart, as working for the Lord." — Colossians 3:23\n\nGratefully,\n{{churchName}} Leadership',
   'email', true),

  (NULL, 'First-Time Donor Thank You', 'Thank you for your generosity, {{firstName}}',
   E'Hi {{firstName}},\n\nThank you for your first gift to {{churchName}}. Your generosity directly supports our mission to serve our community and proclaim the gospel.\n\nWe''ve added you to our weekly giving update so you can see the impact of your contribution. Reply if you have any questions about how funds are used.\n\nGratefully,\n{{churchName}} Stewardship Team',
   'email', true),

  (NULL, 'Care Case Follow-Up', 'Checking in on you, {{firstName}}',
   E'Hi {{firstName}},\n\nA member of our care team wanted to follow up on how you''re doing. Please know that {{churchName}} is here for you — for prayer, for practical help, or just to listen.\n\nReply to this email anytime, or call the church office. We''re praying for you.\n\nIn Christ,\n{{churchName}} Care Team',
   'email', true),

  (NULL, 'Membership Class Invitation', 'Join our next Membership Class',
   E'Hi {{firstName}},\n\nReady to take your next step at {{churchName}}? Our membership class is coming up and we''d love to have you. We''ll cover our beliefs, values, and ways to get involved.\n\nReply to RSVP or ask any questions.\n\nLooking forward to seeing you,\n{{churchName}} Pastoral Team',
   'email', true),

  (NULL, 'Event Reminder', 'Don''t forget: {{eventName}} this {{eventDay}}',
   E'Hi {{firstName}},\n\nJust a friendly reminder that {{eventName}} is coming up on {{eventDay}}.\n\n{{eventDetails}}\n\nWe can''t wait to see you there!\n\n{{churchName}}',
   'email', true),

  -- ─── SMS templates (160 char target) ───
  (NULL, 'SMS — Welcome', NULL,
   'Hi {{firstName}}! Welcome to {{churchName}}. We''re so glad you''re part of our family. Reply with any questions!',
   'sms', true),

  (NULL, 'SMS — Sunday Reminder', NULL,
   'Hi {{firstName}}! Just a reminder that {{churchName}} service is this Sunday at {{serviceTime}}. See you there!',
   'sms', true),

  (NULL, 'SMS — Visitor Follow-Up', NULL,
   'Hi {{firstName}}! It was wonderful having you visit {{churchName}}. We''d love to see you again — reply if you have any questions!',
   'sms', true),

  (NULL, 'SMS — Birthday', NULL,
   'Happy birthday {{firstName}}! Your {{churchName}} family is celebrating you today. May God bless your year ahead.',
   'sms', true),

  (NULL, 'SMS — Service Cancelled (Weather)', NULL,
   'Hi {{firstName}}. Due to weather conditions, {{churchName}} service on {{serviceDate}} is cancelled. We''ll see you next week — stay safe!',
   'sms', true),

  (NULL, 'SMS — Volunteer Reminder', NULL,
   'Hi {{firstName}}! Just a reminder you''re scheduled to serve at {{churchName}} on {{serviceDate}}. Thank you for your service!',
   'sms', true)
ON CONFLICT DO NOTHING;
