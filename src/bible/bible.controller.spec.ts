import { Test, TestingModule } from '@nestjs/testing';
import { BibleController } from './bible.controller';
import { BibleService } from './bible.service';

describe('BibleController', () => {
  let controller: BibleController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BibleController],
      providers: [BibleService],
    }).compile();

    controller = module.get<BibleController>(BibleController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
