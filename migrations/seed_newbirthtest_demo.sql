-- ============================================================
-- SEED DATA: "New Birth Test" Church — Demo Population
-- Run in Supabase SQL Editor. Safe to re-run (ON CONFLICT DO NOTHING).
-- Creates ~1,500+ rows across 25+ tables.
-- ============================================================

DO $$
DECLARE
  tid UUID; -- tenant ID for "New Birth Test"
  -- User IDs (75 members)
  u01 UUID := gen_random_uuid(); u02 UUID := gen_random_uuid(); u03 UUID := gen_random_uuid();
  u04 UUID := gen_random_uuid(); u05 UUID := gen_random_uuid(); u06 UUID := gen_random_uuid();
  u07 UUID := gen_random_uuid(); u08 UUID := gen_random_uuid(); u09 UUID := gen_random_uuid();
  u10 UUID := gen_random_uuid(); u11 UUID := gen_random_uuid(); u12 UUID := gen_random_uuid();
  u13 UUID := gen_random_uuid(); u14 UUID := gen_random_uuid(); u15 UUID := gen_random_uuid();
  u16 UUID := gen_random_uuid(); u17 UUID := gen_random_uuid(); u18 UUID := gen_random_uuid();
  u19 UUID := gen_random_uuid(); u20 UUID := gen_random_uuid(); u21 UUID := gen_random_uuid();
  u22 UUID := gen_random_uuid(); u23 UUID := gen_random_uuid(); u24 UUID := gen_random_uuid();
  u25 UUID := gen_random_uuid(); u26 UUID := gen_random_uuid(); u27 UUID := gen_random_uuid();
  u28 UUID := gen_random_uuid(); u29 UUID := gen_random_uuid(); u30 UUID := gen_random_uuid();
  u31 UUID := gen_random_uuid(); u32 UUID := gen_random_uuid(); u33 UUID := gen_random_uuid();
  u34 UUID := gen_random_uuid(); u35 UUID := gen_random_uuid(); u36 UUID := gen_random_uuid();
  u37 UUID := gen_random_uuid(); u38 UUID := gen_random_uuid(); u39 UUID := gen_random_uuid();
  u40 UUID := gen_random_uuid(); u41 UUID := gen_random_uuid(); u42 UUID := gen_random_uuid();
  u43 UUID := gen_random_uuid(); u44 UUID := gen_random_uuid(); u45 UUID := gen_random_uuid();
  u46 UUID := gen_random_uuid(); u47 UUID := gen_random_uuid(); u48 UUID := gen_random_uuid();
  u49 UUID := gen_random_uuid(); u50 UUID := gen_random_uuid(); u51 UUID := gen_random_uuid();
  u52 UUID := gen_random_uuid(); u53 UUID := gen_random_uuid(); u54 UUID := gen_random_uuid();
  u55 UUID := gen_random_uuid(); u56 UUID := gen_random_uuid(); u57 UUID := gen_random_uuid();
  u58 UUID := gen_random_uuid(); u59 UUID := gen_random_uuid(); u60 UUID := gen_random_uuid();
  u61 UUID := gen_random_uuid(); u62 UUID := gen_random_uuid(); u63 UUID := gen_random_uuid();
  u64 UUID := gen_random_uuid(); u65 UUID := gen_random_uuid(); u66 UUID := gen_random_uuid();
  u67 UUID := gen_random_uuid(); u68 UUID := gen_random_uuid(); u69 UUID := gen_random_uuid();
  u70 UUID := gen_random_uuid(); u71 UUID := gen_random_uuid(); u72 UUID := gen_random_uuid();
  u73 UUID := gen_random_uuid(); u74 UUID := gen_random_uuid(); u75 UUID := gen_random_uuid();
  -- Shared IDs for foreign keys
  g1 UUID := gen_random_uuid(); g2 UUID := gen_random_uuid(); g3 UUID := gen_random_uuid();
  g4 UUID := gen_random_uuid(); g5 UUID := gen_random_uuid(); g6 UUID := gen_random_uuid();
  e1 UUID := gen_random_uuid(); e2 UUID := gen_random_uuid(); e3 UUID := gen_random_uuid();
  e4 UUID := gen_random_uuid(); e5 UUID := gen_random_uuid(); e6 UUID := gen_random_uuid();
  e7 UUID := gen_random_uuid(); e8 UUID := gen_random_uuid(); e9 UUID := gen_random_uuid();
  e10 UUID := gen_random_uuid(); e11 UUID := gen_random_uuid(); e12 UUID := gen_random_uuid();
  f1 UUID := gen_random_uuid(); f2 UUID := gen_random_uuid(); f3 UUID := gen_random_uuid(); f4 UUID := gen_random_uuid();
  s1 UUID := gen_random_uuid(); s2 UUID := gen_random_uuid(); s3 UUID := gen_random_uuid();
  sv1 UUID := gen_random_uuid(); sv2 UUID := gen_random_uuid(); sv3 UUID := gen_random_uuid();
  vo1 UUID := gen_random_uuid(); vo2 UUID := gen_random_uuid(); vo3 UUID := gen_random_uuid();
  vo4 UUID := gen_random_uuid(); vo5 UUID := gen_random_uuid();
  t1 UUID := gen_random_uuid(); t2 UUID := gen_random_uuid(); t3 UUID := gen_random_uuid();
  t4 UUID := gen_random_uuid(); t5 UUID := gen_random_uuid(); t6 UUID := gen_random_uuid();
  b1 UUID := gen_random_uuid(); b2 UUID := gen_random_uuid(); b3 UUID := gen_random_uuid();
  b4 UUID := gen_random_uuid(); b5 UUID := gen_random_uuid(); b6 UUID := gen_random_uuid();
  b7 UUID := gen_random_uuid(); b8 UUID := gen_random_uuid();
  cc1 UUID := gen_random_uuid(); cc2 UUID := gen_random_uuid(); cc3 UUID := gen_random_uuid();
  cc4 UUID := gen_random_uuid(); cc5 UUID := gen_random_uuid(); cc6 UUID := gen_random_uuid();
  cc7 UUID := gen_random_uuid(); cc8 UUID := gen_random_uuid();
  tk1 UUID := gen_random_uuid(); tk2 UUID := gen_random_uuid(); tk3 UUID := gen_random_uuid();
  tk4 UUID := gen_random_uuid(); tk5 UUID := gen_random_uuid(); tk6 UUID := gen_random_uuid();
  tk7 UUID := gen_random_uuid(); tk8 UUID := gen_random_uuid(); tk9 UUID := gen_random_uuid();
  tk10 UUID := gen_random_uuid(); tk11 UUID := gen_random_uuid(); tk12 UUID := gen_random_uuid();
  tag1 UUID := gen_random_uuid(); tag2 UUID := gen_random_uuid(); tag3 UUID := gen_random_uuid();
  tag4 UUID := gen_random_uuid(); tag5 UUID := gen_random_uuid(); tag6 UUID := gen_random_uuid();
  sm1 UUID := gen_random_uuid(); sm2 UUID := gen_random_uuid(); sm3 UUID := gen_random_uuid();
  sm4 UUID := gen_random_uuid(); sm5 UUID := gen_random_uuid(); sm6 UUID := gen_random_uuid();
  sm7 UUID := gen_random_uuid(); sm8 UUID := gen_random_uuid(); sm9 UUID := gen_random_uuid();
  sm10 UUID := gen_random_uuid(); sm11 UUID := gen_random_uuid(); sm12 UUID := gen_random_uuid();
  sm13 UUID := gen_random_uuid(); sm14 UUID := gen_random_uuid(); sm15 UUID := gen_random_uuid();
BEGIN
  -- ── Look up tenant ──
  SELECT id INTO tid FROM public.tenants WHERE name ILIKE '%New Birth%' LIMIT 1;
  IF tid IS NULL THEN RAISE EXCEPTION 'Tenant "New Birth Test" not found'; END IF;

  -- ════════════════════════════════════════════════════════════
  -- 1a. AUTH.USERS (Supabase requires this before public.users)
  -- These are stub auth entries — they won't have real passwords
  -- so they can't log in, but they satisfy the FK constraint.
  -- ════════════════════════════════════════════════════════════
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  SELECT uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         em, crypt('demo-seed-not-a-real-password', gen_salt('bf')), now(), ca, ca, '', '', '', ''
  FROM (VALUES
    (u01, 'marcus.johnson@demo.shepard.app', now() - interval '180 days'),
    (u02, 'sarah.williams@demo.shepard.app', now() - interval '175 days'),
    (u03, 'david.thompson@demo.shepard.app', now() - interval '170 days'),
    (u04, 'jessica.brown@demo.shepard.app', now() - interval '165 days'),
    (u05, 'michael.davis@demo.shepard.app', now() - interval '160 days'),
    (u06, 'angela.martinez@demo.shepard.app', now() - interval '155 days'),
    (u07, 'james.wilson@demo.shepard.app', now() - interval '150 days'),
    (u08, 'patricia.taylor@demo.shepard.app', now() - interval '145 days'),
    (u09, 'robert.anderson@demo.shepard.app', now() - interval '140 days'),
    (u10, 'lisa.thomas@demo.shepard.app', now() - interval '135 days'),
    (u11, 'william.jackson@demo.shepard.app', now() - interval '130 days'),
    (u12, 'maria.garcia@demo.shepard.app', now() - interval '125 days'),
    (u13, 'christopher.white@demo.shepard.app', now() - interval '120 days'),
    (u14, 'jennifer.harris@demo.shepard.app', now() - interval '115 days'),
    (u15, 'daniel.clark@demo.shepard.app', now() - interval '110 days'),
    (u16, 'ashley.lewis@demo.shepard.app', now() - interval '105 days'),
    (u17, 'matthew.robinson@demo.shepard.app', now() - interval '100 days'),
    (u18, 'nicole.walker@demo.shepard.app', now() - interval '95 days'),
    (u19, 'joseph.young@demo.shepard.app', now() - interval '90 days'),
    (u20, 'stephanie.allen@demo.shepard.app', now() - interval '85 days'),
    (u21, 'anthony.king@demo.shepard.app', now() - interval '80 days'),
    (u22, 'elizabeth.wright@demo.shepard.app', now() - interval '78 days'),
    (u23, 'andrew.scott@demo.shepard.app', now() - interval '75 days'),
    (u24, 'rachel.green@demo.shepard.app', now() - interval '72 days'),
    (u25, 'joshua.hill@demo.shepard.app', now() - interval '70 days'),
    (u26, 'amanda.adams@demo.shepard.app', now() - interval '68 days'),
    (u27, 'kevin.baker@demo.shepard.app', now() - interval '65 days'),
    (u28, 'tiffany.nelson@demo.shepard.app', now() - interval '62 days'),
    (u29, 'brian.carter@demo.shepard.app', now() - interval '60 days'),
    (u30, 'crystal.mitchell@demo.shepard.app', now() - interval '58 days'),
    (u31, 'jason.perez@demo.shepard.app', now() - interval '55 days'),
    (u32, 'michelle.roberts@demo.shepard.app', now() - interval '52 days'),
    (u33, 'ryan.turner@demo.shepard.app', now() - interval '50 days'),
    (u34, 'kimberly.phillips@demo.shepard.app', now() - interval '48 days'),
    (u35, 'brandon.campbell@demo.shepard.app', now() - interval '45 days'),
    (u36, 'laura.parker@demo.shepard.app', now() - interval '42 days'),
    (u37, 'eric.evans@demo.shepard.app', now() - interval '40 days'),
    (u38, 'heather.edwards@demo.shepard.app', now() - interval '38 days'),
    (u39, 'timothy.collins@demo.shepard.app', now() - interval '35 days'),
    (u40, 'megan.stewart@demo.shepard.app', now() - interval '32 days'),
    (u41, 'steven.sanchez@demo.shepard.app', now() - interval '30 days'),
    (u42, 'amber.morris@demo.shepard.app', now() - interval '28 days'),
    (u43, 'gregory.rogers@demo.shepard.app', now() - interval '26 days'),
    (u44, 'vanessa.reed@demo.shepard.app', now() - interval '24 days'),
    (u45, 'patrick.cook@demo.shepard.app', now() - interval '22 days'),
    (u46, 'diana.morgan@demo.shepard.app', now() - interval '20 days'),
    (u47, 'charles.bell@demo.shepard.app', now() - interval '18 days'),
    (u48, 'gloria.murphy@demo.shepard.app', now() - interval '16 days'),
    (u49, 'derek.bailey@demo.shepard.app', now() - interval '15 days'),
    (u50, 'natalie.rivera@demo.shepard.app', now() - interval '14 days'),
    (u51, 'travis.cooper@demo.shepard.app', now() - interval '13 days'),
    (u52, 'brittany.richardson@demo.shepard.app', now() - interval '12 days'),
    (u53, 'samuel.cox@demo.shepard.app', now() - interval '11 days'),
    (u54, 'victoria.howard@demo.shepard.app', now() - interval '10 days'),
    (u55, 'marcus.ward@demo.shepard.app', now() - interval '9 days'),
    (u56, 'jasmine.torres@demo.shepard.app', now() - interval '8 days'),
    (u57, 'carl.peterson@demo.shepard.app', now() - interval '7 days'),
    (u58, 'danielle.gray@demo.shepard.app', now() - interval '7 days'),
    (u59, 'eugene.ramirez@demo.shepard.app', now() - interval '6 days'),
    (u60, 'monique.james@demo.shepard.app', now() - interval '6 days'),
    (u61, 'terrence.watson@demo.shepard.app', now() - interval '5 days'),
    (u62, 'faith.brooks@demo.shepard.app', now() - interval '5 days'),
    (u63, 'darius.kelly@demo.shepard.app', now() - interval '4 days'),
    (u64, 'joy.sanders@demo.shepard.app', now() - interval '4 days'),
    (u65, 'leon.price@demo.shepard.app', now() - interval '3 days'),
    (u66, 'hope.bennett@demo.shepard.app', now() - interval '3 days'),
    (u67, 'isaiah.wood@demo.shepard.app', now() - interval '2 days'),
    (u68, 'grace.barnes@demo.shepard.app', now() - interval '2 days'),
    (u69, 'elijah.ross@demo.shepard.app', now() - interval '2 days'),
    (u70, 'mercy.henderson@demo.shepard.app', now() - interval '1 day'),
    (u71, 'caleb.coleman@demo.shepard.app', now() - interval '1 day'),
    (u72, 'ruth.jenkins@demo.shepard.app', now() - interval '1 day'),
    (u73, 'nathan.perry@demo.shepard.app', now() - interval '12 hours'),
    (u74, 'esther.powell@demo.shepard.app', now() - interval '6 hours'),
    (u75, 'micah.long@demo.shepard.app', now() - interval '1 hour')
  ) AS t(uid, em, ca)
  ON CONFLICT (id) DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 1b. PUBLIC.USERS (75 fake members)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.users (id, email, full_name, phone, created_at) VALUES
    (u01, 'marcus.johnson@demo.shepard.app', 'Marcus Johnson', '+12145550101', now() - interval '180 days'),
    (u02, 'sarah.williams@demo.shepard.app', 'Sarah Williams', '+12145550102', now() - interval '175 days'),
    (u03, 'david.thompson@demo.shepard.app', 'David Thompson', '+12145550103', now() - interval '170 days'),
    (u04, 'jessica.brown@demo.shepard.app', 'Jessica Brown', '+12145550104', now() - interval '165 days'),
    (u05, 'michael.davis@demo.shepard.app', 'Michael Davis', '+12145550105', now() - interval '160 days'),
    (u06, 'angela.martinez@demo.shepard.app', 'Angela Martinez', '+12145550106', now() - interval '155 days'),
    (u07, 'james.wilson@demo.shepard.app', 'James Wilson', '+12145550107', now() - interval '150 days'),
    (u08, 'patricia.taylor@demo.shepard.app', 'Patricia Taylor', '+12145550108', now() - interval '145 days'),
    (u09, 'robert.anderson@demo.shepard.app', 'Robert Anderson', '+12145550109', now() - interval '140 days'),
    (u10, 'lisa.thomas@demo.shepard.app', 'Lisa Thomas', '+12145550110', now() - interval '135 days'),
    (u11, 'william.jackson@demo.shepard.app', 'William Jackson', '+12145550111', now() - interval '130 days'),
    (u12, 'maria.garcia@demo.shepard.app', 'Maria Garcia', '+12145550112', now() - interval '125 days'),
    (u13, 'christopher.white@demo.shepard.app', 'Christopher White', '+12145550113', now() - interval '120 days'),
    (u14, 'jennifer.harris@demo.shepard.app', 'Jennifer Harris', '+12145550114', now() - interval '115 days'),
    (u15, 'daniel.clark@demo.shepard.app', 'Daniel Clark', '+12145550115', now() - interval '110 days'),
    (u16, 'ashley.lewis@demo.shepard.app', 'Ashley Lewis', '+12145550116', now() - interval '105 days'),
    (u17, 'matthew.robinson@demo.shepard.app', 'Matthew Robinson', '+12145550117', now() - interval '100 days'),
    (u18, 'nicole.walker@demo.shepard.app', 'Nicole Walker', '+12145550118', now() - interval '95 days'),
    (u19, 'joseph.young@demo.shepard.app', 'Joseph Young', '+12145550119', now() - interval '90 days'),
    (u20, 'stephanie.allen@demo.shepard.app', 'Stephanie Allen', '+12145550120', now() - interval '85 days'),
    (u21, 'anthony.king@demo.shepard.app', 'Anthony King', '+12145550121', now() - interval '80 days'),
    (u22, 'elizabeth.wright@demo.shepard.app', 'Elizabeth Wright', '+12145550122', now() - interval '78 days'),
    (u23, 'andrew.scott@demo.shepard.app', 'Andrew Scott', '+12145550123', now() - interval '75 days'),
    (u24, 'rachel.green@demo.shepard.app', 'Rachel Green', '+12145550124', now() - interval '72 days'),
    (u25, 'joshua.hill@demo.shepard.app', 'Joshua Hill', '+12145550125', now() - interval '70 days'),
    (u26, 'amanda.adams@demo.shepard.app', 'Amanda Adams', '+12145550126', now() - interval '68 days'),
    (u27, 'kevin.baker@demo.shepard.app', 'Kevin Baker', '+12145550127', now() - interval '65 days'),
    (u28, 'tiffany.nelson@demo.shepard.app', 'Tiffany Nelson', '+12145550128', now() - interval '62 days'),
    (u29, 'brian.carter@demo.shepard.app', 'Brian Carter', '+12145550129', now() - interval '60 days'),
    (u30, 'crystal.mitchell@demo.shepard.app', 'Crystal Mitchell', '+12145550130', now() - interval '58 days'),
    (u31, 'jason.perez@demo.shepard.app', 'Jason Perez', '+12145550131', now() - interval '55 days'),
    (u32, 'michelle.roberts@demo.shepard.app', 'Michelle Roberts', '+12145550132', now() - interval '52 days'),
    (u33, 'ryan.turner@demo.shepard.app', 'Ryan Turner', '+12145550133', now() - interval '50 days'),
    (u34, 'kimberly.phillips@demo.shepard.app', 'Kimberly Phillips', '+12145550134', now() - interval '48 days'),
    (u35, 'brandon.campbell@demo.shepard.app', 'Brandon Campbell', '+12145550135', now() - interval '45 days'),
    (u36, 'laura.parker@demo.shepard.app', 'Laura Parker', '+12145550136', now() - interval '42 days'),
    (u37, 'eric.evans@demo.shepard.app', 'Eric Evans', '+12145550137', now() - interval '40 days'),
    (u38, 'heather.edwards@demo.shepard.app', 'Heather Edwards', '+12145550138', now() - interval '38 days'),
    (u39, 'timothy.collins@demo.shepard.app', 'Timothy Collins', '+12145550139', now() - interval '35 days'),
    (u40, 'megan.stewart@demo.shepard.app', 'Megan Stewart', '+12145550140', now() - interval '32 days'),
    (u41, 'steven.sanchez@demo.shepard.app', 'Steven Sanchez', '+12145550141', now() - interval '30 days'),
    (u42, 'amber.morris@demo.shepard.app', 'Amber Morris', '+12145550142', now() - interval '28 days'),
    (u43, 'gregory.rogers@demo.shepard.app', 'Gregory Rogers', '+12145550143', now() - interval '26 days'),
    (u44, 'vanessa.reed@demo.shepard.app', 'Vanessa Reed', '+12145550144', now() - interval '24 days'),
    (u45, 'patrick.cook@demo.shepard.app', 'Patrick Cook', '+12145550145', now() - interval '22 days'),
    (u46, 'diana.morgan@demo.shepard.app', 'Diana Morgan', '+12145550146', now() - interval '20 days'),
    (u47, 'charles.bell@demo.shepard.app', 'Charles Bell', '+12145550147', now() - interval '18 days'),
    (u48, 'gloria.murphy@demo.shepard.app', 'Gloria Murphy', '+12145550148', now() - interval '16 days'),
    (u49, 'derek.bailey@demo.shepard.app', 'Derek Bailey', '+12145550149', now() - interval '15 days'),
    (u50, 'natalie.rivera@demo.shepard.app', 'Natalie Rivera', '+12145550150', now() - interval '14 days'),
    (u51, 'travis.cooper@demo.shepard.app', 'Travis Cooper', '+12145550151', now() - interval '13 days'),
    (u52, 'brittany.richardson@demo.shepard.app', 'Brittany Richardson', '+12145550152', now() - interval '12 days'),
    (u53, 'samuel.cox@demo.shepard.app', 'Samuel Cox', '+12145550153', now() - interval '11 days'),
    (u54, 'victoria.howard@demo.shepard.app', 'Victoria Howard', '+12145550154', now() - interval '10 days'),
    (u55, 'marcus.ward@demo.shepard.app', 'Marcus Ward', '+12145550155', now() - interval '9 days'),
    (u56, 'jasmine.torres@demo.shepard.app', 'Jasmine Torres', '+12145550156', now() - interval '8 days'),
    (u57, 'carl.peterson@demo.shepard.app', 'Carl Peterson', '+12145550157', now() - interval '7 days'),
    (u58, 'danielle.gray@demo.shepard.app', 'Danielle Gray', '+12145550158', now() - interval '7 days'),
    (u59, 'eugene.ramirez@demo.shepard.app', 'Eugene Ramirez', '+12145550159', now() - interval '6 days'),
    (u60, 'monique.james@demo.shepard.app', 'Monique James', '+12145550160', now() - interval '6 days'),
    (u61, 'terrence.watson@demo.shepard.app', 'Terrence Watson', '+12145550161', now() - interval '5 days'),
    (u62, 'faith.brooks@demo.shepard.app', 'Faith Brooks', '+12145550162', now() - interval '5 days'),
    (u63, 'darius.kelly@demo.shepard.app', 'Darius Kelly', '+12145550163', now() - interval '4 days'),
    (u64, 'joy.sanders@demo.shepard.app', 'Joy Sanders', '+12145550164', now() - interval '4 days'),
    (u65, 'leon.price@demo.shepard.app', 'Leon Price', '+12145550165', now() - interval '3 days'),
    (u66, 'hope.bennett@demo.shepard.app', 'Hope Bennett', '+12145550166', now() - interval '3 days'),
    (u67, 'isaiah.wood@demo.shepard.app', 'Isaiah Wood', '+12145550167', now() - interval '2 days'),
    (u68, 'grace.barnes@demo.shepard.app', 'Grace Barnes', '+12145550168', now() - interval '2 days'),
    (u69, 'elijah.ross@demo.shepard.app', 'Elijah Ross', '+12145550169', now() - interval '2 days'),
    (u70, 'mercy.henderson@demo.shepard.app', 'Mercy Henderson', '+12145550170', now() - interval '1 day'),
    (u71, 'caleb.coleman@demo.shepard.app', 'Caleb Coleman', '+12145550171', now() - interval '1 day'),
    (u72, 'ruth.jenkins@demo.shepard.app', 'Ruth Jenkins', '+12145550172', now() - interval '1 day'),
    (u73, 'nathan.perry@demo.shepard.app', 'Nathan Perry', '+12145550173', now() - interval '12 hours'),
    (u74, 'esther.powell@demo.shepard.app', 'Esther Powell', '+12145550174', now() - interval '6 hours'),
    (u75, 'micah.long@demo.shepard.app', 'Micah Long', '+12145550175', now() - interval '1 hour')
  ON CONFLICT (id) DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 2. MEMBERSHIPS (roles: 2 pastors, 1 accountant, 1 worship leader, 71 members)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.tenant_memberships (user_id, tenant_id, role, created_at) VALUES
    (u01, tid, 'pastor',         now() - interval '180 days'),
    (u02, tid, 'pastor',         now() - interval '175 days'),
    (u03, tid, 'accountant',     now() - interval '170 days'),
    (u04, tid, 'worship_leader', now() - interval '165 days')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.tenant_memberships (user_id, tenant_id, role, created_at)
  SELECT uid, tid, 'member', u.created_at
  FROM (VALUES
    (u05),(u06),(u07),(u08),(u09),(u10),(u11),(u12),(u13),(u14),(u15),(u16),(u17),(u18),(u19),(u20),
    (u21),(u22),(u23),(u24),(u25),(u26),(u27),(u28),(u29),(u30),(u31),(u32),(u33),(u34),(u35),(u36),
    (u37),(u38),(u39),(u40),(u41),(u42),(u43),(u44),(u45),(u46),(u47),(u48),(u49),(u50),(u51),(u52),
    (u53),(u54),(u55),(u56),(u57),(u58),(u59),(u60),(u61),(u62),(u63),(u64),(u65),(u66),(u67),(u68),
    (u69),(u70),(u71),(u72),(u73),(u74),(u75)
  ) AS t(uid)
  JOIN public.users u ON u.id = uid
  ON CONFLICT DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 3. TAGS (6 tags)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.tags (id, tenant_id, name, color) VALUES
    (tag1, tid, 'Guest', '#9E9E9E'),
    (tag2, tid, 'Volunteer', '#4CAF50'),
    (tag3, tid, 'Youth', '#2196F3'),
    (tag4, tid, 'New Believer', '#FF9800'),
    (tag5, tid, 'Small Group Leader', '#9C27B0'),
    (tag6, tid, 'Worship Team', '#E91E63')
  ON CONFLICT DO NOTHING;

  -- Tag assignments (~100)
  INSERT INTO public.member_tags (tag_id, user_id, assigned_by) VALUES
    -- Guests (newest 15)
    (tag1, u61, u01),(tag1, u62, u01),(tag1, u63, u01),(tag1, u64, u01),(tag1, u65, u01),
    (tag1, u66, u01),(tag1, u67, u01),(tag1, u68, u01),(tag1, u69, u01),(tag1, u70, u01),
    (tag1, u71, u01),(tag1, u72, u01),(tag1, u73, u01),(tag1, u74, u01),(tag1, u75, u01),
    -- Volunteers (20)
    (tag2, u05, u01),(tag2, u06, u01),(tag2, u07, u01),(tag2, u08, u01),(tag2, u09, u01),
    (tag2, u10, u01),(tag2, u11, u01),(tag2, u12, u01),(tag2, u15, u01),(tag2, u17, u01),
    (tag2, u19, u01),(tag2, u21, u01),(tag2, u23, u01),(tag2, u25, u01),(tag2, u27, u01),
    (tag2, u29, u01),(tag2, u31, u01),(tag2, u33, u01),(tag2, u35, u01),(tag2, u37, u01),
    -- Youth (12)
    (tag3, u40, u01),(tag3, u41, u01),(tag3, u42, u01),(tag3, u43, u01),(tag3, u44, u01),
    (tag3, u45, u01),(tag3, u46, u01),(tag3, u47, u01),(tag3, u48, u01),(tag3, u49, u01),
    (tag3, u50, u01),(tag3, u51, u01),
    -- New Believers (8)
    (tag4, u55, u01),(tag4, u56, u01),(tag4, u57, u01),(tag4, u58, u01),
    (tag4, u59, u01),(tag4, u60, u01),(tag4, u61, u01),(tag4, u62, u01),
    -- Small Group Leaders (6)
    (tag5, u05, u01),(tag5, u10, u01),(tag5, u15, u01),(tag5, u20, u01),(tag5, u25, u01),(tag5, u30, u01),
    -- Worship Team (8)
    (tag6, u04, u01),(tag6, u06, u01),(tag6, u12, u01),(tag6, u18, u01),
    (tag6, u24, u01),(tag6, u30, u01),(tag6, u36, u01),(tag6, u42, u01)
  ON CONFLICT DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 4. GIVING FUNDS
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.giving_funds (id, tenant_id, name, description) VALUES
    (f1, tid, 'General Fund', 'General church operations and ministry'),
    (f2, tid, 'Building Fund', 'New building and facility improvements'),
    (f3, tid, 'Missions Fund', 'Global and local mission projects'),
    (f4, tid, 'Youth Ministry', 'Youth programs, camps, and events')
  ON CONFLICT DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 5. TRANSACTIONS (120 donations spread over 6 months)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.transactions (tenant_id, user_id, amount, currency, stripe_payment_intent_id, status, fund_id, created_at) VALUES
    -- Month 1 (6 months ago) — 15 donations
    (tid, u01, 500.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '175 days'),
    (tid, u02, 250.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '173 days'),
    (tid, u05, 100.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '171 days'),
    (tid, u07, 75.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f2, now() - interval '170 days'),
    (tid, u09, 50.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '168 days'),
    (tid, u10, 200.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f3, now() - interval '166 days'),
    (tid, u11, 30.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '164 days'),
    (tid, u13, 150.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f2, now() - interval '162 days'),
    (tid, u14, 45.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '160 days'),
    (tid, u15, 80.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f4, now() - interval '158 days'),
    (tid, u17, 120.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '156 days'),
    (tid, u19, 25.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '155 days'),
    (tid, u20, 300.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '153 days'),
    (tid, u21, 60.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f3, now() - interval '152 days'),
    (tid, u22, 40.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '151 days'),
    -- Month 2 (5 months ago) — 18 donations
    (tid, u01, 500.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '145 days'),
    (tid, u02, 250.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '143 days'),
    (tid, u03, 100.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f2, now() - interval '141 days'),
    (tid, u05, 100.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '140 days'),
    (tid, u08, 175.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '138 days'),
    (tid, u10, 200.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f3, now() - interval '136 days'),
    (tid, u12, 50.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '134 days'),
    (tid, u14, 90.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f4, now() - interval '133 days'),
    (tid, u16, 35.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '131 days'),
    (tid, u18, 65.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '130 days'),
    (tid, u20, 300.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '128 days'),
    (tid, u23, 110.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f2, now() - interval '127 days'),
    (tid, u25, 55.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '125 days'),
    (tid, u27, 20.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '124 days'),
    (tid, u29, 80.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f3, now() - interval '122 days'),
    (tid, u30, 400.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '121 days'),
    (tid, u06, 150.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f2, now() - interval '120 days'),
    (tid, u09, 70.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '119 days'),
    -- Month 3 (4 months ago) — 20 donations
    (tid, u01, 500.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '110 days'),
    (tid, u02, 250.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '108 days'),
    (tid, u05, 125.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '106 days'),
    (tid, u07, 85.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f2, now() - interval '105 days'),
    (tid, u10, 200.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '103 days'),
    (tid, u13, 160.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f3, now() - interval '101 days'),
    (tid, u15, 95.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f4, now() - interval '100 days'),
    (tid, u17, 130.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '98 days'),
    (tid, u20, 350.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '97 days'),
    (tid, u22, 45.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '95 days'),
    (tid, u24, 75.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f2, now() - interval '94 days'),
    (tid, u26, 30.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '92 days'),
    (tid, u28, 200.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '91 days'),
    (tid, u30, 450.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '90 days'),
    (tid, u32, 55.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f3, now() - interval '88 days'),
    (tid, u34, 110.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '87 days'),
    (tid, u36, 40.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f4, now() - interval '86 days'),
    (tid, u38, 85.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '85 days'),
    (tid, u11, 70.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '84 days'),
    (tid, u19, 25.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f2, now() - interval '83 days'),
    -- Month 4 (3 months ago) — 22 donations
    (tid, u01, 500.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '80 days'),
    (tid, u02, 275.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '78 days'),
    (tid, u05, 100.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '77 days'),
    (tid, u08, 190.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f2, now() - interval '75 days'),
    (tid, u10, 200.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '74 days'),
    (tid, u12, 60.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '72 days'),
    (tid, u14, 105.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f3, now() - interval '71 days'),
    (tid, u16, 40.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '70 days'),
    (tid, u18, 75.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f4, now() - interval '68 days'),
    (tid, u20, 325.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '67 days'),
    (tid, u21, 55.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '65 days'),
    (tid, u23, 120.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f2, now() - interval '64 days'),
    (tid, u25, 50.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '63 days'),
    (tid, u27, 30.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '62 days'),
    (tid, u29, 90.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f3, now() - interval '61 days'),
    (tid, u30, 500.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '60 days'),
    (tid, u33, 65.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '59 days'),
    (tid, u35, 140.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f2, now() - interval '58 days'),
    (tid, u37, 35.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '57 days'),
    (tid, u39, 95.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f4, now() - interval '56 days'),
    (tid, u41, 50.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '55 days'),
    (tid, u43, 80.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '54 days'),
    -- Month 5 (2 months ago) — 25 donations
    (tid, u01, 500.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '50 days'),
    (tid, u02, 250.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '49 days'),
    (tid, u03, 150.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f2, now() - interval '48 days'),
    (tid, u05, 100.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '47 days'),
    (tid, u07, 90.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '46 days'),
    (tid, u09, 60.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f3, now() - interval '45 days'),
    (tid, u10, 225.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '44 days'),
    (tid, u11, 40.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '43 days'),
    (tid, u13, 175.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f2, now() - interval '42 days'),
    (tid, u15, 100.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f4, now() - interval '41 days'),
    (tid, u17, 135.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '40 days'),
    (tid, u19, 25.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '39 days'),
    (tid, u20, 375.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '38 days'),
    (tid, u22, 55.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '37 days'),
    (tid, u24, 85.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f3, now() - interval '36 days'),
    (tid, u26, 45.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '35 days'),
    (tid, u28, 210.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '34 days'),
    (tid, u30, 475.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '33 days'),
    (tid, u32, 70.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f2, now() - interval '32 days'),
    (tid, u34, 115.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '31 days'),
    (tid, u36, 50.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f4, now() - interval '30 days'),
    (tid, u38, 95.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '29 days'),
    (tid, u40, 30.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '28 days'),
    (tid, u42, 160.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f2, now() - interval '27 days'),
    (tid, u44, 75.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '26 days'),
    -- Month 6 (this month) — 20 donations
    (tid, u01, 500.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '20 days'),
    (tid, u02, 250.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '18 days'),
    (tid, u05, 125.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '16 days'),
    (tid, u08, 200.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f2, now() - interval '14 days'),
    (tid, u10, 250.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '12 days'),
    (tid, u12, 65.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '11 days'),
    (tid, u14, 110.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f3, now() - interval '10 days'),
    (tid, u16, 50.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '9 days'),
    (tid, u18, 80.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f4, now() - interval '8 days'),
    (tid, u20, 400.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '7 days'),
    (tid, u22, 55.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '6 days'),
    (tid, u24, 90.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f2, now() - interval '5 days'),
    (tid, u26, 35.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '4 days'),
    (tid, u28, 225.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '3 days'),
    (tid, u30, 500.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '2 days'),
    (tid, u33, 70.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '2 days'),
    (tid, u35, 145.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f3, now() - interval '1 day'),
    (tid, u37, 40.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '1 day'),
    (tid, u39, 100.00, 'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f1, now() - interval '12 hours'),
    (tid, u41, 60.00,  'usd', 'pi_demo_' || gen_random_uuid(), 'succeeded', f4, now() - interval '6 hours')
  ON CONFLICT DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 6. SERVICE SCHEDULES + CHECK-INS (200+ over 12 weeks)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.services (id, tenant_id, name, day_of_week, start_time) VALUES
    (sv1, tid, 'Sunday Morning Worship', 0, '09:00'),
    (sv2, tid, 'Sunday Evening Service', 0, '18:00'),
    (sv3, tid, 'Wednesday Bible Study', 3, '19:00')
  ON CONFLICT DO NOTHING;

  -- Generate check-ins for 12 weeks of Sundays + some Wednesdays
  INSERT INTO public.check_ins (tenant_id, user_id, service_id, checked_in_at, check_in_type)
  SELECT tid, uid, svc, ts, 'manual'
  FROM (
    -- Sunday mornings (40-55 people each week for 12 weeks)
    SELECT unnest(ARRAY[u01,u02,u03,u04,u05,u06,u07,u08,u09,u10,u11,u12,u13,u14,u15,u16,u17,u18,u19,u20,
                        u21,u22,u23,u24,u25,u26,u27,u28,u29,u30,u31,u32,u33,u34,u35,u36,u37,u38,u39,u40]) AS uid,
           sv1 AS svc, (now() - interval '84 days' + (9 * interval '1 hour')) AS ts
    UNION ALL
    SELECT unnest(ARRAY[u01,u02,u03,u05,u06,u08,u09,u10,u11,u13,u14,u15,u17,u18,u19,u20,
                        u22,u23,u25,u26,u27,u29,u30,u31,u33,u34,u35,u37,u38,u39,u41,u42,u43,u44,u45]),
           sv1, (now() - interval '77 days' + (9 * interval '1 hour'))
    UNION ALL
    SELECT unnest(ARRAY[u01,u02,u04,u05,u07,u08,u10,u11,u12,u14,u15,u16,u18,u19,u20,u21,
                        u23,u24,u26,u27,u28,u30,u31,u32,u34,u35,u36,u38,u39,u40,u42,u43,u45,u46,u47,u48]),
           sv1, (now() - interval '70 days' + (9 * interval '1 hour'))
    UNION ALL
    SELECT unnest(ARRAY[u01,u02,u03,u05,u06,u07,u09,u10,u11,u13,u14,u15,u17,u18,u20,u21,
                        u22,u24,u25,u27,u28,u30,u31,u33,u35,u36,u38,u39,u41,u42,u44,u45,u47,u48,u49,u50]),
           sv1, (now() - interval '63 days' + (9 * interval '1 hour'))
    UNION ALL
    SELECT unnest(ARRAY[u01,u02,u04,u05,u06,u08,u10,u11,u12,u14,u15,u16,u18,u19,u20,u22,
                        u23,u25,u26,u28,u29,u30,u32,u33,u35,u36,u37,u39,u40,u41,u43,u44,u46,u47,u49,u50,u51,u52]),
           sv1, (now() - interval '56 days' + (9 * interval '1 hour'))
    UNION ALL
    SELECT unnest(ARRAY[u01,u02,u03,u05,u07,u08,u09,u10,u12,u13,u15,u16,u17,u19,u20,u21,
                        u23,u24,u26,u27,u29,u30,u31,u33,u34,u36,u37,u38,u40,u41,u43,u44,u45,u47,u48,u50,u51,u53,u54]),
           sv1, (now() - interval '49 days' + (9 * interval '1 hour'))
    UNION ALL
    SELECT unnest(ARRAY[u01,u02,u04,u05,u06,u08,u10,u11,u13,u14,u15,u17,u18,u20,u21,u22,
                        u24,u25,u27,u28,u30,u31,u32,u34,u35,u37,u38,u39,u41,u42,u44,u45,u46,u48,u49,u51,u52,u54,u55,u56]),
           sv1, (now() - interval '42 days' + (9 * interval '1 hour'))
    UNION ALL
    SELECT unnest(ARRAY[u01,u02,u03,u05,u06,u07,u09,u10,u11,u13,u15,u16,u17,u19,u20,u22,
                        u23,u25,u26,u28,u29,u30,u32,u33,u35,u36,u38,u39,u40,u42,u43,u45,u46,u48,u49,u50,u52,u53,u55,u56,u57]),
           sv1, (now() - interval '35 days' + (9 * interval '1 hour'))
    UNION ALL
    SELECT unnest(ARRAY[u01,u02,u04,u05,u08,u09,u10,u12,u14,u15,u16,u18,u19,u20,u21,u23,
                        u24,u26,u27,u29,u30,u31,u33,u34,u36,u37,u39,u40,u41,u43,u44,u46,u47,u49,u50,u52,u53,u55,u56,u58,u59]),
           sv1, (now() - interval '28 days' + (9 * interval '1 hour'))
    UNION ALL
    SELECT unnest(ARRAY[u01,u02,u03,u05,u06,u07,u10,u11,u13,u14,u15,u17,u18,u20,u22,u23,
                        u25,u26,u28,u29,u30,u32,u33,u35,u36,u38,u39,u41,u42,u44,u45,u47,u48,u50,u51,u53,u54,u56,u57,u59,u60,u61]),
           sv1, (now() - interval '21 days' + (9 * interval '1 hour'))
    UNION ALL
    SELECT unnest(ARRAY[u01,u02,u04,u05,u06,u08,u09,u10,u12,u14,u15,u16,u18,u19,u20,u21,
                        u23,u24,u26,u27,u29,u30,u31,u33,u34,u36,u37,u39,u40,u42,u43,u45,u46,u48,u49,u51,u52,u54,u55,u57,u58,u60,u61,u62]),
           sv1, (now() - interval '14 days' + (9 * interval '1 hour'))
    UNION ALL
    SELECT unnest(ARRAY[u01,u02,u03,u05,u06,u07,u09,u10,u11,u13,u15,u16,u17,u19,u20,u22,
                        u23,u25,u26,u28,u29,u30,u32,u33,u35,u36,u38,u39,u41,u42,u44,u45,u47,u48,u50,u51,u53,u54,u56,u57,u59,u60,u62,u63,u64]),
           sv1, (now() - interval '7 days' + (9 * interval '1 hour'))
  ) sub(uid, svc, ts);

  -- Wednesday Bible Study (15-20 people, last 6 weeks)
  INSERT INTO public.check_ins (tenant_id, user_id, service_id, checked_in_at, check_in_type)
  SELECT tid, uid, sv3, ts, 'manual'
  FROM (
    SELECT unnest(ARRAY[u01,u02,u05,u10,u15,u20,u25,u30,u35,u40,u45,u50,u55,u60]) AS uid, (now() - interval '39 days' + (19 * interval '1 hour')) AS ts
    UNION ALL SELECT unnest(ARRAY[u01,u02,u03,u10,u15,u17,u20,u25,u27,u30,u33,u35,u40,u42,u45,u50]), (now() - interval '32 days' + (19 * interval '1 hour'))
    UNION ALL SELECT unnest(ARRAY[u01,u02,u05,u08,u10,u15,u18,u20,u25,u28,u30,u35,u38,u40,u45,u48,u50]), (now() - interval '25 days' + (19 * interval '1 hour'))
    UNION ALL SELECT unnest(ARRAY[u01,u02,u03,u05,u10,u13,u15,u20,u23,u25,u30,u33,u35,u40,u43,u45,u50,u53]), (now() - interval '18 days' + (19 * interval '1 hour'))
    UNION ALL SELECT unnest(ARRAY[u01,u02,u05,u07,u10,u12,u15,u17,u20,u22,u25,u27,u30,u32,u35,u37,u40,u42,u45]), (now() - interval '11 days' + (19 * interval '1 hour'))
    UNION ALL SELECT unnest(ARRAY[u01,u02,u03,u05,u08,u10,u13,u15,u18,u20,u23,u25,u28,u30,u33,u35,u38,u40,u43,u45]), (now() - interval '4 days' + (19 * interval '1 hour'))
  ) sub(uid, ts);

  -- ════════════════════════════════════════════════════════════
  -- 7. GROUPS (6) + MEMBERS + MESSAGES
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.groups (id, tenant_id, name, description, created_by) VALUES
    (g1, tid, 'Men''s Fellowship',      'Weekly men''s group for fellowship and accountability', u01),
    (g2, tid, 'Women''s Bible Study',    'Deep dive into Scripture together',                    u02),
    (g3, tid, 'Young Adults',            'Community for ages 18-30',                             u01),
    (g4, tid, 'Marriage & Family',       'Strengthening marriages and families',                 u02),
    (g5, tid, 'Prayer Warriors',         'Dedicated intercessory prayer team',                   u01),
    (g6, tid, 'Worship Team Rehearsal',  'Coordination for Sunday worship',                      u04)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.group_members (group_id, user_id) VALUES
    (g1,u01),(g1,u03),(g1,u05),(g1,u07),(g1,u09),(g1,u11),(g1,u13),(g1,u15),(g1,u17),(g1,u19),(g1,u21),(g1,u23),(g1,u25),(g1,u27),(g1,u29),
    (g2,u02),(g2,u04),(g2,u06),(g2,u08),(g2,u10),(g2,u12),(g2,u14),(g2,u16),(g2,u18),(g2,u20),(g2,u22),(g2,u24),(g2,u26),(g2,u28),(g2,u30),
    (g3,u40),(g3,u41),(g3,u42),(g3,u43),(g3,u44),(g3,u45),(g3,u46),(g3,u47),(g3,u48),(g3,u49),(g3,u50),(g3,u51),
    (g4,u01),(g4,u02),(g4,u05),(g4,u06),(g4,u09),(g4,u10),(g4,u13),(g4,u14),(g4,u17),(g4,u18),(g4,u21),(g4,u22),
    (g5,u01),(g5,u02),(g5,u08),(g5,u15),(g5,u20),(g5,u25),(g5,u30),(g5,u35),(g5,u40),(g5,u45),(g5,u50),
    (g6,u04),(g6,u06),(g6,u12),(g6,u18),(g6,u24),(g6,u30),(g6,u36),(g6,u42)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.group_messages (group_id, author_id, content, created_at) VALUES
    (g1, u01, 'Great discussion tonight brothers! See everyone next week.', now() - interval '3 days'),
    (g1, u05, 'Praying for all of you this week. Stay strong!', now() - interval '2 days'),
    (g1, u09, 'Who''s bringing snacks next time?', now() - interval '1 day'),
    (g2, u02, 'Ladies, we''re starting Proverbs 31 study next week!', now() - interval '5 days'),
    (g2, u08, 'I loved tonight''s discussion. So encouraging!', now() - interval '4 days'),
    (g2, u14, 'Can we do a potluck for our next meeting?', now() - interval '3 days'),
    (g3, u40, 'Game night this Friday at the church! Who''s in?', now() - interval '2 days'),
    (g3, u43, 'Count me in! I''ll bring board games.', now() - interval '2 days'),
    (g3, u46, 'Can''t wait! See everyone there.', now() - interval '1 day'),
    (g4, u01, 'Date night ideas anyone? Let''s plan something as couples.', now() - interval '4 days'),
    (g4, u06, 'How about a group dinner at that new Italian place?', now() - interval '3 days'),
    (g5, u01, 'Please keep Sister Johnson in your prayers — surgery tomorrow.', now() - interval '1 day'),
    (g5, u08, 'Praying now. God is faithful!', now() - interval '1 day'),
    (g5, u15, 'Lifting her up right now. 🙏', now() - interval '12 hours'),
    (g6, u04, 'Rehearsal moved to Saturday 4pm this week. New songs to learn!', now() - interval '3 days'),
    (g6, u12, 'Got it! I''ll have the chord charts ready.', now() - interval '2 days')
  ON CONFLICT DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 8. EVENTS (12 — 6 past, 6 upcoming)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.events (id, tenant_id, title, description, start_at, end_at, location, created_by) VALUES
    (e1,  tid, 'Easter Sunday Celebration', 'Special Easter service with choir performance', now() - interval '60 days', now() - interval '60 days' + interval '3 hours', 'Main Sanctuary', u01),
    (e2,  tid, 'Youth Lock-In', 'Overnight youth event with games and worship', now() - interval '45 days', now() - interval '44 days', 'Fellowship Hall', u02),
    (e3,  tid, 'Community Outreach Day', 'Serving our local community', now() - interval '30 days', now() - interval '30 days' + interval '5 hours', 'Church Parking Lot', u01),
    (e4,  tid, 'Marriage Retreat', 'Weekend marriage enrichment retreat', now() - interval '21 days', now() - interval '19 days', 'Lake House Retreat Center', u02),
    (e5,  tid, 'Vacation Bible School', '5-day VBS for kids ages 5-12', now() - interval '14 days', now() - interval '10 days', 'Children''s Wing', u01),
    (e6,  tid, 'Worship Night', 'Extended worship and prayer night', now() - interval '7 days', now() - interval '7 days' + interval '3 hours', 'Main Sanctuary', u04),
    (e7,  tid, 'Men''s Breakfast', 'Monthly men''s fellowship breakfast', now() + interval '3 days', now() + interval '3 days' + interval '2 hours', 'Fellowship Hall', u01),
    (e8,  tid, 'Women''s Conference', 'Annual women''s empowerment conference', now() + interval '10 days', now() + interval '10 days' + interval '8 hours', 'Main Sanctuary', u02),
    (e9,  tid, 'Summer Baptism Service', 'Outdoor baptism at the lake', now() + interval '17 days', now() + interval '17 days' + interval '3 hours', 'City Lake Park', u01),
    (e10, tid, 'Youth Summer Camp', '3-day youth camp', now() + interval '30 days', now() + interval '32 days', 'Camp New Life', u02),
    (e11, tid, 'Back to School Prayer', 'Prayer service for students and teachers', now() + interval '45 days', now() + interval '45 days' + interval '2 hours', 'Main Sanctuary', u01),
    (e12, tid, 'Church Anniversary Celebration', 'Celebrating our church family', now() + interval '60 days', now() + interval '60 days' + interval '4 hours', 'Main Sanctuary + Fellowship Hall', u01)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.event_rsvps (event_id, user_id, status) VALUES
    (e7,u01,'going'),(e7,u03,'going'),(e7,u05,'going'),(e7,u07,'going'),(e7,u09,'going'),(e7,u11,'going'),(e7,u13,'going'),(e7,u15,'going'),(e7,u17,'going'),(e7,u19,'interested'),
    (e8,u02,'going'),(e8,u04,'going'),(e8,u06,'going'),(e8,u08,'going'),(e8,u10,'going'),(e8,u12,'going'),(e8,u14,'going'),(e8,u16,'going'),(e8,u18,'going'),(e8,u20,'going'),(e8,u22,'interested'),(e8,u24,'going'),
    (e9,u01,'going'),(e9,u02,'going'),(e9,u05,'going'),(e9,u10,'going'),(e9,u15,'going'),(e9,u20,'going'),(e9,u25,'going'),(e9,u30,'going'),(e9,u55,'going'),(e9,u56,'going'),(e9,u57,'going'),(e9,u58,'going'),
    (e10,u40,'going'),(e10,u41,'going'),(e10,u42,'going'),(e10,u43,'going'),(e10,u44,'going'),(e10,u45,'going'),(e10,u46,'going'),(e10,u47,'going'),(e10,u48,'interested'),(e10,u49,'going'),(e10,u50,'going'),
    (e11,u01,'going'),(e11,u02,'going'),(e11,u05,'going'),(e11,u10,'going'),(e11,u15,'going'),(e11,u20,'going'),(e11,u25,'going'),(e11,u30,'going'),
    (e12,u01,'going'),(e12,u02,'going'),(e12,u03,'going'),(e12,u04,'going'),(e12,u05,'going'),(e12,u10,'going'),(e12,u15,'going'),(e12,u20,'going'),(e12,u25,'going'),(e12,u30,'going'),(e12,u35,'going'),(e12,u40,'going'),(e12,u45,'going'),(e12,u50,'going')
  ON CONFLICT DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 9. POSTS (40) + COMMENTS (80) + LIKES (150)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.posts (id, tenant_id, author_id, content, media_type, created_at) VALUES
    (gen_random_uuid(), tid, u01, 'Good morning church family! "The Lord is my shepherd; I shall not want." - Psalm 23:1. Have a blessed day!', 'text', now() - interval '30 days'),
    (gen_random_uuid(), tid, u02, 'What an incredible worship service today! God showed up in a mighty way. If you missed it, the sermon replay will be up soon.', 'text', now() - interval '29 days'),
    (gen_random_uuid(), tid, u05, 'Prayer request: Please keep my family in prayer as we navigate some health challenges. God is good and we trust His plan.', 'text', now() - interval '28 days'),
    (gen_random_uuid(), tid, u10, 'Just signed up to volunteer for the community outreach! Who else is joining? Let''s make a difference together! 🙌', 'text', now() - interval '27 days'),
    (gen_random_uuid(), tid, u04, 'Worship team rehearsal tonight at 7pm! We''re learning two new songs for Sunday. See you there! 🎵', 'text', now() - interval '26 days'),
    (gen_random_uuid(), tid, u15, 'Grateful for this church family. Moving to a new city was scary but you all made me feel right at home from day one.', 'text', now() - interval '25 days'),
    (gen_random_uuid(), tid, u20, '"For I know the plans I have for you, declares the Lord." Jeremiah 29:11. Trusting God with my career change.', 'text', now() - interval '24 days'),
    (gen_random_uuid(), tid, u01, 'Reminder: Men''s breakfast this Saturday at 8am! Bring your appetite and your Bible. 📖🍳', 'text', now() - interval '23 days'),
    (gen_random_uuid(), tid, u02, 'Ladies Bible study recap: We explored the power of forgiveness in Matthew 18. Such a powerful discussion!', 'text', now() - interval '22 days'),
    (gen_random_uuid(), tid, u30, 'Testimony time! God answered my prayer — after 6 months of searching, I finally got the job! Glory to God!', 'text', now() - interval '21 days'),
    (gen_random_uuid(), tid, u08, 'Happy birthday to our amazing worship leader! 🎂 Thank you for leading us into God''s presence every Sunday.', 'text', now() - interval '20 days'),
    (gen_random_uuid(), tid, u12, 'The youth group had an amazing lock-in last night! Pizza, games, worship, and no sleep 😂 These kids are the future!', 'text', now() - interval '19 days'),
    (gen_random_uuid(), tid, u25, 'Devotional thought: "Be still and know that I am God." In our busy world, let''s make time to just be with Him.', 'text', now() - interval '18 days'),
    (gen_random_uuid(), tid, u35, 'First time visiting New Birth today and WOW. The love here is real. Looking forward to next Sunday!', 'text', now() - interval '17 days'),
    (gen_random_uuid(), tid, u01, 'Sunday sermon series starts: "Kingdom Living" — 6 weeks exploring what it means to live as citizens of heaven.', 'text', now() - interval '16 days'),
    (gen_random_uuid(), tid, u40, 'Young adults hangout was so fun! Nothing like fellowship with people who get you. ❤️', 'text', now() - interval '15 days'),
    (gen_random_uuid(), tid, u06, 'Volunteered at the food bank today with the outreach team. Served 200+ families! This is what church is about.', 'text', now() - interval '14 days'),
    (gen_random_uuid(), tid, u18, 'Marriage retreat was life-changing! Thank you Pastor Marcus and Sarah for organizing it. Our marriage is stronger!', 'text', now() - interval '13 days'),
    (gen_random_uuid(), tid, u02, 'VBS was a huge success! 85 kids, 30 volunteers, and 12 first-time decisions for Christ! 🙏', 'text', now() - interval '12 days'),
    (gen_random_uuid(), tid, u22, 'Can someone recommend a good daily devotional app? Trying to be more consistent with my quiet time.', 'text', now() - interval '11 days'),
    (gen_random_uuid(), tid, u45, 'Baptism Sunday was beautiful. Seeing people publicly declare their faith never gets old! 💧', 'text', now() - interval '10 days'),
    (gen_random_uuid(), tid, u01, 'Church family, let''s rally together for the Henderson family. They lost their home in the fire. Donation link in announcements.', 'text', now() - interval '9 days'),
    (gen_random_uuid(), tid, u33, 'Small group was amazing tonight. We studied James 1 and talked about perseverance through trials. So good!', 'text', now() - interval '8 days'),
    (gen_random_uuid(), tid, u50, 'I''m new here but already feel like family. Thank you for the warm welcome at the visitor lunch today!', 'text', now() - interval '7 days'),
    (gen_random_uuid(), tid, u02, 'Announcement: Special guest speaker next Sunday — Bishop Thomas from Faith Community Church! Don''t miss it!', 'text', now() - interval '6 days'),
    (gen_random_uuid(), tid, u07, 'Started reading through the entire Bible this year. Currently in Exodus. Anyone want to join a reading plan group?', 'text', now() - interval '5 days'),
    (gen_random_uuid(), tid, u14, 'Praise report: Mom''s surgery went well! Thank you all for the prayers. God is a healer! 🙌', 'text', now() - interval '4 days'),
    (gen_random_uuid(), tid, u01, '"Let us not become weary in doing good, for at the proper time we will reap a harvest." Galatians 6:9', 'text', now() - interval '4 days'),
    (gen_random_uuid(), tid, u55, 'Just got baptized today! Best decision of my life. Thank you New Birth family for walking this journey with me.', 'text', now() - interval '3 days'),
    (gen_random_uuid(), tid, u28, 'Choir practice was fire tonight 🔥 Sunday is going to be special. Get ready church!', 'text', now() - interval '3 days'),
    (gen_random_uuid(), tid, u38, 'Looking for carpool partners for Wednesday Bible study. Anyone coming from the Southside?', 'text', now() - interval '2 days'),
    (gen_random_uuid(), tid, u02, 'Women''s conference registration is OPEN! Early bird pricing through next Friday. Link in the events section.', 'text', now() - interval '2 days'),
    (gen_random_uuid(), tid, u10, 'Finished my first month volunteering in children''s church. These kids have taught ME more about faith than I taught them!', 'text', now() - interval '2 days'),
    (gen_random_uuid(), tid, u60, 'Brand new to the faith and brand new to New Birth. Every Sunday I learn something that changes my perspective. God is so good.', 'text', now() - interval '1 day'),
    (gen_random_uuid(), tid, u01, 'This Sunday: "Kingdom Living Part 4 — The Power of Generosity." Bring your giving hearts and open minds!', 'text', now() - interval '1 day'),
    (gen_random_uuid(), tid, u20, 'Update on my job search: Started the new position today! Thank you for all the prayers and encouragement. God is faithful!', 'text', now() - interval '1 day'),
    (gen_random_uuid(), tid, u43, 'Youth group challenge: 30 days of prayer! Who''s in? Drop a 🙏 below!', 'text', now() - interval '18 hours'),
    (gen_random_uuid(), tid, u04, 'New worship song we''re learning: "Goodness of God" by Bethel Music. It''s going to be powerful Sunday!', 'text', now() - interval '12 hours'),
    (gen_random_uuid(), tid, u30, 'Thankful for my small group brothers. Iron sharpens iron! 🗡️', 'text', now() - interval '6 hours'),
    (gen_random_uuid(), tid, u02, 'See you all tomorrow morning! Doors open at 8:30, worship starts at 9. Bring a friend! ❤️', 'text', now() - interval '2 hours')
  ON CONFLICT DO NOTHING;

  -- Comments on posts (using subquery to find post IDs)
  INSERT INTO public.comments (post_id, tenant_id, author_id, content, created_at)
  SELECT p.id, tid, author, comment, p.created_at + interval '1 hour' * c.match_num
  FROM (SELECT id, created_at, ROW_NUMBER() OVER (ORDER BY created_at) AS post_num FROM public.posts WHERE tenant_id = tid ORDER BY created_at LIMIT 40) p
  CROSS JOIN LATERAL (VALUES
    (1, u05, 'Amen! 🙏'),
    (2, u10, 'Such a blessing!'),
    (3, u15, 'Praying for you! God''s got this.'),
    (4, u20, 'Count me in!'),
    (5, u25, 'Powerful word today!'),
    (6, u30, 'So true! God is good.'),
    (7, u35, 'Thank you for sharing!'),
    (8, u40, 'Excited about this!'),
    (9, u45, 'God is faithful!'),
    (10, u50, 'Love this church family!')
  ) AS c(match_num, author, comment)
  WHERE c.match_num = ((p.post_num - 1) % 10) + 1;

  -- Additional comments for variety (second round)
  INSERT INTO public.comments (post_id, tenant_id, author_id, content, created_at)
  SELECT p.id, tid, author, comment, p.created_at + interval '3 hours' * c.match_num
  FROM (SELECT id, created_at, ROW_NUMBER() OVER (ORDER BY created_at) AS post_num FROM public.posts WHERE tenant_id = tid ORDER BY created_at LIMIT 40) p
  CROSS JOIN LATERAL (VALUES
    (1, u06, 'This blessed my heart today.'),
    (2, u11, 'God is so good!'),
    (3, u16, 'Lifting you up in prayer right now.'),
    (4, u21, 'Let''s go! 💪'),
    (5, u26, 'Needed to hear this.'),
    (6, u31, 'Yes and amen!'),
    (7, u36, 'What a testimony!'),
    (8, u41, 'Can''t wait!'),
    (9, u46, 'Beautiful!'),
    (10, u51, 'Welcome to the family!')
  ) AS c(match_num, author, comment)
  WHERE c.match_num = ((p.post_num - 1) % 10) + 1;

  -- Post likes (~4 likes per post on average)
  INSERT INTO public.post_likes (post_id, user_id, tenant_id)
  SELECT p.id, liker, tid
  FROM (SELECT id FROM public.posts WHERE tenant_id = tid ORDER BY created_at LIMIT 40) p
  CROSS JOIN LATERAL (
    SELECT unnest(ARRAY[u01,u02,u05,u10]) AS liker
  ) likers
  ON CONFLICT DO NOTHING;

  -- More likes spread across different users
  INSERT INTO public.post_likes (post_id, user_id, tenant_id)
  SELECT p.id, liker, tid
  FROM (SELECT id FROM public.posts WHERE tenant_id = tid ORDER BY created_at LIMIT 20) p
  CROSS JOIN LATERAL (
    SELECT unnest(ARRAY[u15,u20,u25,u30,u35,u40]) AS liker
  ) likers
  ON CONFLICT DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 10. PRAYERS (20) + PRAYS (60)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.prayers (tenant_id, author_id, content, is_anonymous, is_answered, created_at) VALUES
    (tid, u05, 'Please pray for my mother. She''s been diagnosed with cancer and we''re trusting God for healing.', false, false, now() - interval '25 days'),
    (tid, u08, 'Praying for wisdom as I make a big career decision. God, direct my steps.', false, false, now() - interval '23 days'),
    (tid, u12, 'My marriage is going through a tough season. Please lift us up.', true, false, now() - interval '21 days'),
    (tid, u15, 'Praise God! My son got into college with a full scholarship! Answered prayer!', false, true, now() - interval '20 days'),
    (tid, u18, 'Please pray for our missionaries in Haiti. They''re facing supply shortages.', false, false, now() - interval '18 days'),
    (tid, u22, 'Struggling with anxiety. Asking for peace that surpasses understanding.', true, false, now() - interval '16 days'),
    (tid, u25, 'God answered! After months of applications, I got the job! Thank you for praying!', false, true, now() - interval '14 days'),
    (tid, u28, 'Please pray for our youth. So many are dealing with peer pressure and identity struggles.', false, false, now() - interval '12 days'),
    (tid, u32, 'My father is having heart surgery next week. Please cover him in prayer.', false, false, now() - interval '10 days'),
    (tid, u35, 'Praise report: My sister accepted Christ this weekend! Years of prayer answered!', false, true, now() - interval '9 days'),
    (tid, u38, 'Praying for our church as we grow. May God give our pastors wisdom and strength.', false, false, now() - interval '8 days'),
    (tid, u40, 'Please pray for my friend who is battling addiction. He needs breakthrough.', true, false, now() - interval '7 days'),
    (tid, u43, 'Pray for our school — students and teachers as the semester gets harder.', false, false, now() - interval '6 days'),
    (tid, u45, 'God is healing my marriage! We started counseling and things are getting better. Praise Him!', false, true, now() - interval '5 days'),
    (tid, u48, 'Financial breakthrough needed. Trusting God to provide for my family.', true, false, now() - interval '4 days'),
    (tid, u50, 'Please pray for safety as I travel internationally next week for work.', false, false, now() - interval '3 days'),
    (tid, u53, 'Praying for revival in our city. Lord, pour out Your Spirit!', false, false, now() - interval '2 days'),
    (tid, u55, 'Just found out I''m pregnant! Praying for a healthy pregnancy. So grateful!', false, false, now() - interval '1 day'),
    (tid, u58, 'Pray for our neighbors — their house was damaged in the storm last night.', false, false, now() - interval '12 hours'),
    (tid, u01, 'Church family, let''s unite in prayer for our nation. Lord, bring peace and healing.', false, false, now() - interval '6 hours')
  ON CONFLICT DO NOTHING;

  -- Prayer prays (3 people praying per request on average)
  INSERT INTO public.prayer_prays (prayer_id, user_id)
  SELECT pr.id, pray_er
  FROM (SELECT id FROM public.prayers WHERE tenant_id = tid ORDER BY created_at LIMIT 20) pr
  CROSS JOIN LATERAL (SELECT unnest(ARRAY[u01,u02,u10]) AS pray_er) p
  ON CONFLICT DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 11. SERMONS (15 across 3 series)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.sermons (id, tenant_id, title, speaker, series_name, duration, view_count, like_count, created_at) VALUES
    (sm1,  tid, 'Walking in Faith: The Beginning',    'Pastor Marcus Johnson',  'Walking in Faith',  2700, 156, 42, now() - interval '90 days'),
    (sm2,  tid, 'Walking in Faith: Trust the Process', 'Pastor Marcus Johnson',  'Walking in Faith',  2850, 143, 38, now() - interval '83 days'),
    (sm3,  tid, 'Walking in Faith: When God is Silent','Pastor Marcus Johnson',  'Walking in Faith',  3100, 189, 55, now() - interval '76 days'),
    (sm4,  tid, 'Walking in Faith: Breakthrough',      'Pastor Marcus Johnson',  'Walking in Faith',  2950, 201, 62, now() - interval '69 days'),
    (sm5,  tid, 'Walking in Faith: Victory',           'Pastor Marcus Johnson',  'Walking in Faith',  2600, 167, 48, now() - interval '62 days'),
    (sm6,  tid, 'The Psalms: Songs of Praise',         'Pastor Sarah Williams',  'The Psalms',        2400, 134, 35, now() - interval '55 days'),
    (sm7,  tid, 'The Psalms: Crying Out to God',       'Pastor Sarah Williams',  'The Psalms',        2700, 128, 31, now() - interval '48 days'),
    (sm8,  tid, 'The Psalms: Finding Rest',            'Pastor Sarah Williams',  'The Psalms',        2550, 142, 40, now() - interval '41 days'),
    (sm9,  tid, 'The Psalms: Warrior Praise',          'Pastor Sarah Williams',  'The Psalms',        2900, 155, 44, now() - interval '34 days'),
    (sm10, tid, 'The Psalms: God Our Refuge',          'Pastor Sarah Williams',  'The Psalms',        2650, 139, 37, now() - interval '27 days'),
    (sm11, tid, 'Kingdom Living: What Is the Kingdom?','Pastor Marcus Johnson',  'Kingdom Living',    3000, 178, 51, now() - interval '20 days'),
    (sm12, tid, 'Kingdom Living: Kingdom Values',      'Pastor Marcus Johnson',  'Kingdom Living',    2800, 165, 46, now() - interval '13 days'),
    (sm13, tid, 'Kingdom Living: Kingdom Authority',   'Pastor Marcus Johnson',  'Kingdom Living',    3200, 192, 58, now() - interval '6 days'),
    (sm14, tid, 'Kingdom Living: The Power of Generosity','Pastor Marcus Johnson','Kingdom Living',   2750, 88,  22, now() - interval '1 day'),
    (sm15, tid, 'Guest Speaker: The Heart of Worship', 'Bishop David Thomas',    NULL,                3100, 45,  12, now() - interval '3 hours')
  ON CONFLICT DO NOTHING;

  UPDATE public.sermons SET is_featured = true WHERE id = sm14;

  -- ════════════════════════════════════════════════════════════
  -- 12. ANNOUNCEMENTS (8)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.announcements (tenant_id, author_id, title, body, priority, created_at) VALUES
    (tid, u01, 'Summer Baptism Service', 'Join us at City Lake Park on the 27th for our summer baptism! If you''d like to be baptized, sign up at the welcome desk.', 'general', now() - interval '10 days'),
    (tid, u02, 'Women''s Conference Registration Open', 'Early bird pricing available through next Friday! Register in the events section.', 'general', now() - interval '8 days'),
    (tid, u01, 'Henderson Family Fire Relief', 'The Henderson family lost their home. Donations being collected through the Building Fund. Every dollar helps.', 'urgent', now() - interval '7 days'),
    (tid, u01, 'New Sermon Series: Kingdom Living', 'Starting a 6-week journey into Kingdom principles. Don''t miss a single week!', 'general', now() - interval '20 days'),
    (tid, u03, 'Quarterly Financial Report Available', 'The Q1 financial report is available for review. See the accountant''s office for details.', 'general', now() - interval '15 days'),
    (tid, u02, 'Childcare Volunteers Needed', 'We need 5 more childcare volunteers for the 11am service. Sign up in the volunteer section!', 'general', now() - interval '5 days'),
    (tid, u01, 'Church Anniversary Celebration', 'Save the date! Our annual church anniversary celebration is coming up. Details in the events section.', 'general', now() - interval '3 days'),
    (tid, u04, 'Worship Team Auditions', 'Looking for singers and musicians to join the worship team. Auditions next Saturday at 2pm.', 'general', now() - interval '1 day')
  ON CONFLICT DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 13. VOLUNTEERS (5 roles + signups + hours)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.volunteer_opportunities (id, tenant_id, role_name, description, schedule, spots_available) VALUES
    (vo1, tid, 'Usher / Greeter',       'Welcome members and guests, distribute bulletins',     'Every Sunday 8:30-9:15 AM', 8),
    (vo2, tid, 'Children''s Church',     'Lead activities and teach kids ages 3-12',             'Sundays during 9 AM service', 6),
    (vo3, tid, 'Parking Lot Attendant',  'Direct traffic and assist with parking',               'Sundays 8:00-9:30 AM', 4),
    (vo4, tid, 'Media / Tech Team',      'Run sound, slides, and livestream',                    'Every Sunday, arrive by 8 AM', 4),
    (vo5, tid, 'Food / Hospitality',     'Prepare refreshments and fellowship meal coordination','As needed for events', 10)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.volunteer_signups (opportunity_id, user_id) VALUES
    (vo1,u05),(vo1,u06),(vo1,u07),(vo1,u08),(vo1,u09),(vo1,u11),
    (vo2,u10),(vo2,u12),(vo2,u14),(vo2,u16),(vo2,u18),
    (vo3,u19),(vo3,u21),(vo3,u23),
    (vo4,u25),(vo4,u27),(vo4,u29),(vo4,u31),
    (vo5,u33),(vo5,u35),(vo5,u37),(vo5,u39),(vo5,u41),(vo5,u43),(vo5,u45)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.volunteer_hours (tenant_id, user_id, opportunity_id, hours, date, notes) VALUES
    (tid, u05, vo1, 2.0, CURRENT_DATE - 7,  'Sunday greeting'),
    (tid, u06, vo1, 2.0, CURRENT_DATE - 7,  'Sunday greeting'),
    (tid, u07, vo1, 2.0, CURRENT_DATE - 14, 'Sunday greeting'),
    (tid, u10, vo2, 3.0, CURRENT_DATE - 7,  'Children''s church lesson'),
    (tid, u12, vo2, 3.0, CURRENT_DATE - 7,  'Children''s church crafts'),
    (tid, u14, vo2, 3.0, CURRENT_DATE - 14, 'Children''s church'),
    (tid, u19, vo3, 1.5, CURRENT_DATE - 7,  'Parking lot'),
    (tid, u21, vo3, 1.5, CURRENT_DATE - 14, 'Parking lot'),
    (tid, u25, vo4, 4.0, CURRENT_DATE - 7,  'Sound and slides'),
    (tid, u27, vo4, 4.0, CURRENT_DATE - 14, 'Livestream'),
    (tid, u29, vo4, 4.0, CURRENT_DATE - 21, 'Full media setup'),
    (tid, u33, vo5, 3.0, CURRENT_DATE - 7,  'Fellowship meal prep'),
    (tid, u35, vo5, 2.5, CURRENT_DATE - 14, 'Refreshments'),
    (tid, u37, vo5, 3.0, CURRENT_DATE - 21, 'Easter potluck'),
    (tid, u39, vo5, 2.0, CURRENT_DATE - 28, 'Coffee station')
  ON CONFLICT DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 14. CARE CASES (8) + NOTES (15)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.care_cases (id, tenant_id, member_id, title, description, status, priority, assigned_to, created_by, created_at) VALUES
    (cc1, tid, u32, 'Hospital visit needed',          'Member recovering from surgery',          'in_progress', 'high',   u01, u01, now() - interval '10 days'),
    (cc2, tid, u22, 'Anxiety and mental health support','Requested counseling resources',         'in_progress', 'medium', u02, u02, now() - interval '8 days'),
    (cc3, tid, u48, 'Financial hardship',              'Lost job, needs assistance with rent',    'new',         'urgent', u01, u01, now() - interval '5 days'),
    (cc4, tid, u12, 'Marriage counseling',             'Couple requested pastoral counseling',    'in_progress', 'medium', u01, u02, now() - interval '20 days'),
    (cc5, tid, u38, 'Grief support',                   'Lost a parent recently',                 'in_progress', 'high',   u02, u02, now() - interval '15 days'),
    (cc6, tid, u55, 'New believer follow-up',          'Needs discipleship connection',           'new',         'medium', u01, u01, now() - interval '3 days'),
    (cc7, tid, u15, 'Bereavement visit',               'Family member passed',                   'resolved',    'high',   u01, u01, now() - interval '30 days'),
    (cc8, tid, u25, 'Home repair assistance',           'Elderly member needs help with repairs', 'resolved',    'low',    u02, u02, now() - interval '25 days')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.care_notes (care_case_id, author_id, content, created_at) VALUES
    (cc1, u01, 'Visited at hospital. Surgery went well. Needs 6 weeks recovery.', now() - interval '9 days'),
    (cc1, u02, 'Arranged meal train for the family. 8 families signed up.', now() - interval '7 days'),
    (cc2, u02, 'Met with member. Referred to Christian counseling center.', now() - interval '7 days'),
    (cc2, u02, 'Follow-up call. Member reports feeling better after first session.', now() - interval '3 days'),
    (cc3, u01, 'Assessed situation. Connecting with benevolence fund committee.', now() - interval '4 days'),
    (cc4, u01, 'First counseling session completed. Both partners engaged.', now() - interval '18 days'),
    (cc4, u01, 'Second session. Communication exercises assigned.', now() - interval '11 days'),
    (cc4, u01, 'Third session. Significant progress noted.', now() - interval '4 days'),
    (cc5, u02, 'Home visit. Prayed together. Connected with grief support group.', now() - interval '14 days'),
    (cc5, u02, 'Follow-up. Attending grief group regularly.', now() - interval '7 days'),
    (cc6, u01, 'Called to welcome. Set up discipleship meeting for next week.', now() - interval '2 days'),
    (cc7, u01, 'Attended funeral. Family appreciative of church support.', now() - interval '28 days'),
    (cc7, u02, 'Follow-up visit. Family doing well. Case resolved.', now() - interval '20 days'),
    (cc8, u02, 'Organized volunteer team for home repairs.', now() - interval '23 days'),
    (cc8, u02, 'Repairs completed. Member very grateful. Case resolved.', now() - interval '18 days')
  ON CONFLICT DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 15. TASKS (12)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.tasks (id, tenant_id, title, description, status, priority, assigned_to, created_by, due_date, created_at) VALUES
    (tk1,  tid, 'Order new communion supplies',          'Running low on cups and bread',            'completed',   'medium', u03, u01, CURRENT_DATE - 5,  now() - interval '14 days'),
    (tk2,  tid, 'Update church website banner',          'Add summer events promotional banner',     'completed',   'low',    u04, u01, CURRENT_DATE - 3,  now() - interval '10 days'),
    (tk3,  tid, 'Schedule AC maintenance',               'Annual HVAC inspection due',               'in_progress', 'medium', u03, u01, CURRENT_DATE + 7,  now() - interval '7 days'),
    (tk4,  tid, 'Recruit VBS volunteers',                'Need 10 more volunteers for VBS',          'completed',   'high',   u02, u01, CURRENT_DATE - 7,  now() - interval '20 days'),
    (tk5,  tid, 'Follow up with first-time visitors',    'Call all visitors from last Sunday',       'in_progress', 'high',   u01, u02, CURRENT_DATE + 2,  now() - interval '3 days'),
    (tk6,  tid, 'Prepare quarterly financial report',    'Q2 report for board meeting',              'pending',     'high',   u03, u01, CURRENT_DATE + 14, now() - interval '5 days'),
    (tk7,  tid, 'Plan youth summer camp logistics',      'Bus, meals, activities, chaperones',       'in_progress', 'medium', u02, u01, CURRENT_DATE + 21, now() - interval '10 days'),
    (tk8,  tid, 'Organize church anniversary committee', 'Recruit team for anniversary planning',    'pending',     'medium', u01, u02, CURRENT_DATE + 30, now() - interval '3 days'),
    (tk9,  tid, 'Fix projector in Fellowship Hall',      'Bulb needs replacement',                   'pending',     'low',    u04, u01, CURRENT_DATE + 7,  now() - interval '5 days'),
    (tk10, tid, 'Send thank-you notes to donors',        'Monthly donor appreciation letters',       'pending',     'medium', u03, u01, CURRENT_DATE + 5,  now() - interval '2 days'),
    (tk11, tid, 'Review security camera footage',        'Parking lot incident report',              'completed',   'urgent', u01, u01, CURRENT_DATE - 1,  now() - interval '4 days'),
    (tk12, tid, 'Update member directory photos',        'Take new photos during Sunday service',    'pending',     'low',    u04, u02, CURRENT_DATE + 14, now() - interval '1 day')
  ON CONFLICT DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 16. BADGES (8) + AWARDS (30)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.badges (id, tenant_id, name, description, icon, color, tier, category, auto_award_rule, display_order, created_by) VALUES
    (b1, tid, 'First Steps',       'Attended your first service',           'footprints',     '#4CAF50', 'bronze', 'attendance',  '{"type":"attendance_count","count":1}',        1, u01),
    (b2, tid, 'Faithful Attender', 'Attended 10 services',                  'calendar-check', '#2196F3', 'silver', 'attendance',  '{"type":"attendance_count","count":10}',       2, u01),
    (b3, tid, 'Prayer Warrior',    'Submitted 5 prayer requests',           'hands-praying',  '#9C27B0', 'bronze', 'spiritual',   '{"type":"prayer_count","min":5}',              3, u01),
    (b4, tid, 'Generous Giver',    'Donated a total of $500+',             'heart-handshake','#E91E63', 'silver', 'giving',      '{"type":"giving_lifetime","threshold":500}',   4, u01),
    (b5, tid, 'Baptized',          'Publicly declared your faith',          'droplets',       '#00BCD4', 'gold',   'spiritual',   '{"type":"baptized"}',                          5, u01),
    (b6, tid, 'Community Builder', 'Joined 3 or more groups',              'users',          '#FF9800', 'silver', 'engagement',  '{"type":"group_count","min":3}',               6, u01),
    (b7, tid, 'Servant Heart',     'Logged 10+ volunteer hours',           'hand-heart',     '#795548', 'silver', 'service',     '{"type":"volunteer_hours","min":10}',          7, u01),
    (b8, tid, 'Social Butterfly',  'Created 5 or more posts',             'message-circle', '#607D8B', 'bronze', 'engagement',  '{"type":"post_count","min":5}',                8, u01)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.member_badges (badge_id, user_id, tenant_id, awarded_reason) VALUES
    -- First Steps (lots of people)
    (b1, u05, tid, 'Attended first service'), (b1, u06, tid, 'Attended first service'), (b1, u07, tid, 'Attended first service'),
    (b1, u08, tid, 'Attended first service'), (b1, u09, tid, 'Attended first service'), (b1, u10, tid, 'Attended first service'),
    (b1, u15, tid, 'Attended first service'), (b1, u20, tid, 'Attended first service'), (b1, u25, tid, 'Attended first service'),
    (b1, u30, tid, 'Attended first service'), (b1, u35, tid, 'Attended first service'), (b1, u40, tid, 'Attended first service'),
    -- Faithful Attender
    (b2, u01, tid, '10+ check-ins'), (b2, u02, tid, '10+ check-ins'), (b2, u05, tid, '10+ check-ins'),
    (b2, u10, tid, '10+ check-ins'), (b2, u15, tid, '10+ check-ins'), (b2, u20, tid, '10+ check-ins'),
    -- Generous Giver
    (b4, u01, tid, '$500+ lifetime giving'), (b4, u02, tid, '$500+ lifetime giving'), (b4, u10, tid, '$500+ lifetime giving'),
    (b4, u20, tid, '$500+ lifetime giving'), (b4, u30, tid, '$500+ lifetime giving'),
    -- Baptized
    (b5, u55, tid, 'Baptized at summer service'), (b5, u15, tid, 'Baptized'),
    -- Community Builder
    (b6, u01, tid, '3+ groups'), (b6, u02, tid, '3+ groups'),
    -- Servant Heart
    (b7, u25, tid, '10+ volunteer hours'), (b7, u29, tid, '10+ volunteer hours'),
    -- Social Butterfly
    (b8, u01, tid, '5+ posts'), (b8, u02, tid, '5+ posts')
  ON CONFLICT DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 17. MEMBER JOURNEYS (75 — varied spiritual stages)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.member_journeys (tenant_id, user_id, attended_members_class, members_class_date, is_baptized, baptism_date, salvation_date, discipleship_track, skills, interests)
  SELECT tid, uid,
    members_class, CASE WHEN members_class THEN CURRENT_DATE - (random()*180)::int ELSE NULL END,
    baptized, CASE WHEN baptized THEN CURRENT_DATE - (random()*365)::int ELSE NULL END,
    CURRENT_DATE - (random()*3650)::int,
    track,
    CASE (random()*4)::int WHEN 0 THEN ARRAY['Music/Singing'] WHEN 1 THEN ARRAY['Teaching','Counseling'] WHEN 2 THEN ARRAY['IT/Technology','Video/Photography'] ELSE ARRAY['Cooking/Baking','Event Planning'] END,
    CASE (random()*4)::int WHEN 0 THEN ARRAY['Worship/Music'] WHEN 1 THEN ARRAY['Youth Ministry','Small Groups'] WHEN 2 THEN ARRAY['Outreach/Missions','Prayer Ministry'] ELSE ARRAY['Hospitality/Greeting','Media/Tech'] END
  FROM (VALUES
    (u01,true,true,'leadership'),(u02,true,true,'leadership'),(u03,true,true,'maturity'),(u04,true,true,'maturity'),
    (u05,true,true,'growth'),(u06,true,true,'growth'),(u07,true,true,'growth'),(u08,true,false,'growth'),
    (u09,true,true,'maturity'),(u10,true,true,'leadership'),(u11,true,true,'growth'),(u12,false,true,'foundations'),
    (u13,true,true,'maturity'),(u14,true,false,'growth'),(u15,true,true,'leadership'),(u16,false,false,'foundations'),
    (u17,true,true,'growth'),(u18,true,true,'maturity'),(u19,false,true,'growth'),(u20,true,true,'leadership'),
    (u21,true,true,'growth'),(u22,false,false,'foundations'),(u23,true,true,'maturity'),(u24,true,false,'growth'),
    (u25,true,true,'leadership'),(u26,false,true,'growth'),(u27,true,true,'maturity'),(u28,true,true,'growth'),
    (u29,true,false,'growth'),(u30,true,true,'leadership'),(u31,false,true,'foundations'),(u32,true,false,'growth'),
    (u33,true,true,'maturity'),(u34,false,false,'foundations'),(u35,true,true,'growth'),(u36,true,true,'growth'),
    (u37,false,true,'growth'),(u38,true,false,'foundations'),(u39,true,true,'maturity'),(u40,false,false,'exploring'),
    (u41,false,false,'exploring'),(u42,false,true,'foundations'),(u43,false,false,'exploring'),(u44,false,false,'exploring'),
    (u45,true,true,'growth'),(u46,false,false,'exploring'),(u47,false,false,'exploring'),(u48,true,false,'foundations'),
    (u49,false,false,'exploring'),(u50,false,false,'exploring'),(u51,false,false,'exploring'),(u52,false,true,'foundations'),
    (u53,false,false,'exploring'),(u54,false,false,'exploring'),(u55,true,true,'foundations'),(u56,false,false,'exploring'),
    (u57,false,false,'exploring'),(u58,false,false,'exploring'),(u59,false,false,'exploring'),(u60,false,false,'exploring'),
    (u61,false,false,'exploring'),(u62,false,false,'exploring'),(u63,false,false,'exploring'),(u64,false,false,'exploring'),
    (u65,false,false,'exploring'),(u66,false,false,'exploring'),(u67,false,false,'exploring'),(u68,false,false,'exploring'),
    (u69,false,false,'exploring'),(u70,false,false,'exploring'),(u71,false,false,'exploring'),(u72,false,false,'exploring'),
    (u73,false,false,'exploring'),(u74,false,false,'exploring'),(u75,false,false,'exploring')
  ) AS v(uid, members_class, baptized, track)
  ON CONFLICT DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 18. STORIES (5 active)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.stories (author_id, tenant_id, text, background_color, expires_at, created_at) VALUES
    (u01, tid, 'Sunday is going to be POWERFUL! Don''t miss Kingdom Living Part 5!', '#1a237e', now() + interval '12 hours', now() - interval '12 hours'),
    (u02, tid, 'Women''s conference countdown: 10 days! Register now!', '#880e4f', now() + interval '18 hours', now() - interval '6 hours'),
    (u04, tid, 'New worship song alert 🎵 "Goodness of God" this Sunday!', '#1b5e20', now() + interval '20 hours', now() - interval '4 hours'),
    (u30, tid, 'Grateful for this church family! 6 months strong 💪', '#4a148c', now() + interval '22 hours', now() - interval '2 hours'),
    (u40, tid, 'Young adults hangout tonight! Don''t forget!', '#e65100', now() + interval '23 hours', now() - interval '1 hour')
  ON CONFLICT DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 19. FOLLOWS (50 relationships)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.follows (follower_id, following_id) VALUES
    (u05,u01),(u06,u01),(u07,u01),(u08,u01),(u09,u01),(u10,u01),(u15,u01),(u20,u01),(u25,u01),(u30,u01),
    (u35,u01),(u40,u01),(u45,u01),(u50,u01),(u55,u01),(u60,u01),(u65,u01),(u70,u01),(u75,u01),
    (u05,u02),(u06,u02),(u08,u02),(u10,u02),(u12,u02),(u14,u02),(u16,u02),(u18,u02),(u20,u02),(u22,u02),
    (u24,u02),(u26,u02),(u28,u02),(u30,u02),(u35,u02),(u40,u02),
    (u40,u04),(u41,u04),(u42,u04),(u43,u04),(u06,u04),(u12,u04),(u18,u04),(u24,u04),(u30,u04),(u36,u04),
    (u01,u02),(u02,u01),(u01,u04),(u04,u01)
  ON CONFLICT DO NOTHING;

  -- ════════════════════════════════════════════════════════════
  -- 20. NOTIFICATIONS (20)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO public.notifications (recipient_id, tenant_id, type, payload, created_at) VALUES
    (u01, tid, 'NEW_COMMENT', '{"postId":"placeholder","authorName":"Michael Davis","preview":"Amen! 🙏"}', now() - interval '2 hours'),
    (u01, tid, 'NEW_COMMENT', '{"postId":"placeholder","authorName":"Lisa Thomas","preview":"Such a blessing!"}', now() - interval '4 hours'),
    (u01, tid, 'POST_LIKE', '{"postId":"placeholder","likerName":"Joshua Hill"}', now() - interval '6 hours'),
    (u01, tid, 'EVENT_RSVP', '{"eventId":"placeholder","eventTitle":"Men''s Breakfast","userName":"Daniel Clark","status":"going"}', now() - interval '8 hours'),
    (u01, tid, 'NEW_PRAYER', '{"prayerId":"placeholder","preview":"Please pray for my neighbor..."}', now() - interval '10 hours'),
    (u02, tid, 'NEW_COMMENT', '{"postId":"placeholder","authorName":"Angela Martinez","preview":"Thank you for sharing!"}', now() - interval '1 hour'),
    (u02, tid, 'EVENT_RSVP', '{"eventId":"placeholder","eventTitle":"Women''s Conference","userName":"Heather Edwards","status":"going"}', now() - interval '3 hours'),
    (u02, tid, 'POST_LIKE', '{"postId":"placeholder","likerName":"Marcus Ward"}', now() - interval '5 hours'),
    (u05, tid, 'NEW_COMMENT', '{"postId":"placeholder","authorName":"Pastor Marcus","preview":"Praying for you!"}', now() - interval '2 hours'),
    (u10, tid, 'BADGE_EARNED', '{"badgeName":"First Steps","badgeIcon":"footprints"}', now() - interval '7 days'),
    (u20, tid, 'BADGE_EARNED', '{"badgeName":"Generous Giver","badgeIcon":"heart-handshake"}', now() - interval '5 days'),
    (u30, tid, 'BADGE_EARNED', '{"badgeName":"Generous Giver","badgeIcon":"heart-handshake"}', now() - interval '3 days'),
    (u40, tid, 'GROUP_MESSAGE', '{"groupName":"Young Adults","authorName":"Joshua Hill","preview":"Game night this Friday!"}', now() - interval '2 days'),
    (u55, tid, 'BADGE_EARNED', '{"badgeName":"Baptized","badgeIcon":"droplets"}', now() - interval '3 days'),
    (u01, tid, 'CARE_CASE', '{"caseTitle":"Financial hardship","memberName":"Nicole Walker","priority":"urgent"}', now() - interval '5 days'),
    (u01, tid, 'TASK_ASSIGNED', '{"taskTitle":"Follow up with first-time visitors","priority":"high"}', now() - interval '3 days'),
    (u02, tid, 'CARE_CASE', '{"caseTitle":"Anxiety and mental health support","memberName":"Elizabeth Wright"}', now() - interval '8 days'),
    (u03, tid, 'TASK_ASSIGNED', '{"taskTitle":"Prepare quarterly financial report","priority":"high"}', now() - interval '5 days'),
    (u04, tid, 'TASK_ASSIGNED', '{"taskTitle":"Update church website banner","priority":"low"}', now() - interval '10 days'),
    (u50, tid, 'WELCOME', '{"message":"Welcome to New Birth Test! We''re glad you''re here."}', now() - interval '7 days')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE '✅ Seed data complete for "New Birth Test" (tenant %). ~1500 rows inserted.', tid;
END $$;
