import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [SearchController],
  providers: [SearchService, RlsContextInterceptor],
})
export class SearchModule {}
