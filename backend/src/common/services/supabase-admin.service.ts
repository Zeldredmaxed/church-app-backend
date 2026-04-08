import { Global, Module, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Shared Supabase Admin client (service role).
 *
 * Provides a single, reusable SupabaseClient instance instead of each
 * service creating its own. Inject this wherever you need admin-level
 * Supabase operations (auth admin, storage, etc.).
 */
@Injectable()
export class SupabaseAdminService {
  readonly client: SupabaseClient;

  constructor(config: ConfigService) {
    this.client = createClient(
      config.getOrThrow('SUPABASE_URL'),
      config.getOrThrow('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
}

@Global()
@Module({
  providers: [SupabaseAdminService],
  exports: [SupabaseAdminService],
})
export class SupabaseAdminModule {}
