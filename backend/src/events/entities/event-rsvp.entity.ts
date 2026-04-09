import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'event_rsvps' })
export class EventRsvp {
  @PrimaryColumn('uuid', { name: 'event_id' })
  eventId: string;

  @PrimaryColumn('uuid', { name: 'user_id' })
  userId: string;

  @Column({ type: 'text' })
  status: 'going' | 'interested' | 'not_going';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
