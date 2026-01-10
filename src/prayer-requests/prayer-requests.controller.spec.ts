import { Test, TestingModule } from '@nestjs/testing';
import { PrayerRequestsController } from './prayer-requests.controller';
import { PrayerRequestsService } from './prayer-requests.service';

describe('PrayerRequestsController', () => {
  let controller: PrayerRequestsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PrayerRequestsController],
      providers: [PrayerRequestsService],
    }).compile();

    controller = module.get<PrayerRequestsController>(PrayerRequestsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
