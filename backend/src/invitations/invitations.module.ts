import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [InvitationsController],
  providers: [InvitationsService, RlsContextInterceptor],
})
export class InvitationsModule {}
