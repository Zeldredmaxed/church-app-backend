-- Migration 067: Extended user profile fields.
--
-- Adds all the optional profile keys the mobile section-editor uses.
-- Every column is nullable — existing users keep NULL until they set
-- a value. Scalar fields get CHECK constraints where the value set is
-- bounded; free-form fields are pure TEXT. JSONB columns hold shapes
-- the backend doesn't validate strictly (address, children,
-- emergency contact) so the mobile can iterate the UI without
-- another migration each time.
--
-- Privacy: nothing here is exposed by RLS to non-admins. The
-- existing `users: select self or same-tenant member` policy still
-- gates reads — this migration just adds columns to that policy's
-- already-permitted rows. The privacy filter on public-facing
-- endpoints is enforced in service code (never SELECT * — explicit
-- field lists for public payloads).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone_secondary           TEXT,
  ADD COLUMN IF NOT EXISTS address                   JSONB,
  ADD COLUMN IF NOT EXISTS preferred_contact_method  TEXT
    CHECK (preferred_contact_method IS NULL
           OR preferred_contact_method IN ('email', 'phone', 'sms', 'mail')),
  ADD COLUMN IF NOT EXISTS date_of_birth             DATE,
  ADD COLUMN IF NOT EXISTS occupation                TEXT,
  ADD COLUMN IF NOT EXISTS employer                  TEXT,
  ADD COLUMN IF NOT EXISTS marital_status            TEXT
    CHECK (marital_status IS NULL
           OR marital_status IN ('single', 'married', 'engaged',
                                  'separated', 'divorced', 'widowed')),
  ADD COLUMN IF NOT EXISTS anniversary               DATE,
  ADD COLUMN IF NOT EXISTS spouse_name               TEXT,
  ADD COLUMN IF NOT EXISTS has_children              BOOLEAN,
  ADD COLUMN IF NOT EXISTS children                  JSONB,
  ADD COLUMN IF NOT EXISTS emergency_contact         JSONB,
  ADD COLUMN IF NOT EXISTS membership_status         TEXT,
  ADD COLUMN IF NOT EXISTS member_since              DATE,
  ADD COLUMN IF NOT EXISTS baptized                  BOOLEAN,
  ADD COLUMN IF NOT EXISTS baptism_date              DATE,
  ADD COLUMN IF NOT EXISTS baptism_location          TEXT,
  ADD COLUMN IF NOT EXISTS salvation_date            DATE,
  ADD COLUMN IF NOT EXISTS previous_church           TEXT,
  ADD COLUMN IF NOT EXISTS how_did_you_hear          TEXT,
  ADD COLUMN IF NOT EXISTS service_interests         TEXT[],
  ADD COLUMN IF NOT EXISTS skills                    TEXT[],
  ADD COLUMN IF NOT EXISTS languages                 TEXT[],
  ADD COLUMN IF NOT EXISTS tshirt_size               TEXT
    CHECK (tshirt_size IS NULL
           OR tshirt_size IN ('XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL')),
  ADD COLUMN IF NOT EXISTS dietary_restrictions      TEXT[],
  ADD COLUMN IF NOT EXISTS newsletter_opt_in         BOOLEAN,
  ADD COLUMN IF NOT EXISTS sms_opt_in                BOOLEAN,
  ADD COLUMN IF NOT EXISTS photo_release_consent     BOOLEAN,
  ADD COLUMN IF NOT EXISTS birthday_visible          BOOLEAN,
  ADD COLUMN IF NOT EXISTS anniversary_visible       BOOLEAN;
