import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'sermon_likes' })
export class SermonLike {
  @PrimaryColumn({ type: 'uuid', name: 'sermon_id' })
  sermonId: string;

  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
