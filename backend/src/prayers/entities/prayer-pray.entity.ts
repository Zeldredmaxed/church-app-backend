import { Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'prayer_prays' })
export class PrayerPray {
  @PrimaryColumn('uuid', { name: 'prayer_id' })
  prayerId: string;

  @PrimaryColumn('uuid', { name: 'user_id' })
  userId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
