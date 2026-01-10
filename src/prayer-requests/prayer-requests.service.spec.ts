import { Test, TestingModule } from '@nestjs/testing';
import { PrayerRequestsService } from './prayer-requests.service';

describe('PrayerRequestsService', () => {
  let service: PrayerRequestsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrayerRequestsService],
    }).compile();

    service = module.get<PrayerRequestsService>(PrayerRequestsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
