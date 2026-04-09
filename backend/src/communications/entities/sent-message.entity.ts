import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { AudienceSegment } from './audience-segment.entity';
import { MessageTemplate } from './message-template.entity';

@Entity({ schema: 'public', name: 'sent_messages' })
export class SentMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', nullable: true, name: 'segment_id' })
  segmentId: string | null;

  @ManyToOne(() => AudienceSegment, { eager: false })
  @JoinColumn({ name: 'segment_id' })
  segment?: AudienceSegment;

  @Column({ type: 'uuid', nullable: true, name: 'template_id' })
  templateId: string | null;

  @ManyToOne(() => MessageTemplate, { eager: false })
  @JoinColumn({ name: 'template_id' })
  template?: MessageTemplate;

  @Column({ type: 'text' })
  channel: string;

  @Column({ type: 'text', nullable: true })
  subject: string | null;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'int', name: 'recipient_count', default: 0 })
  recipientCount: number;

  @Column({ type: 'uuid', name: 'sent_by' })
  sentBy: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'sent_by' })
  sender?: User;

  @Column({ type: 'timestamptz', nullable: true, name: 'scheduled_for' })
  scheduledFor: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'sent_at' })
  sentAt: Date | null;

  @Column({ type: 'text', default: 'sent' })
  status: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
