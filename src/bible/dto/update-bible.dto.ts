import { PartialType } from '@nestjs/swagger';
import { CreateBibleDto } from './create-bible.dto';

export class UpdateBibleDto extends PartialType(CreateBibleDto) {}
