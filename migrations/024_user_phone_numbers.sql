BEGIN;

-- Add phone number to users for SMS communications
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN public.users.phone IS
  'Phone number for SMS communications. E.164 format (e.g., +15551234567). Set via profile update.';

COMMIT;
