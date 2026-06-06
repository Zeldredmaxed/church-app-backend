import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ProfileCompletenessService } from './profile-completeness.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  imports: [MediaModule],
  controllers: [UsersController],
  providers: [UsersService, ProfileCompletenessService, RlsContextInterceptor],
  exports: [ProfileCompletenessService],
})
export class UsersModule {}
