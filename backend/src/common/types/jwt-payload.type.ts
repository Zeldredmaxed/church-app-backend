/**
 * Shape of the decoded Supabase JWT payload.
 * Supabase injects app_metadata into every issued JWT automatically.
 * The current_tenant_id field is synced there by our handle_tenant_context_switch
 * trigger whenever public.users.last_accessed_tenant_id changes.
 */
export interface SupabaseJwtPayload {
  /** User UUID — maps to auth.users.id and public.users.id */
  sub: string;
  email: string;
  /** Always 'authenticated' for signed-in users */
  role: string;
  aud: string;
  app_metadata: {
    /** Set by the handle_tenant_context_switch trigger. NULL until first tenant assignment. */
    current_tenant_id?: string;
    [key: string]: unknown;
  };
  user_metadata?: Record<string, unknown>;
  iat: number;
  exp: number;
}
