import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ schema: 'public', name: 'notification_preferences' })
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'text' })
  type: string;

  @Column({ type: 'boolean', name: 'push_enabled', default: true })
  pushEnabled: boolean;

  @Column({ type: 'boolean', name: 'in_app_enabled', default: true })
  inAppEnabled: boolean;

  @Column({ type: 'boolean', name: 'email_enabled', default: false })
  emailEnabled: boolean;
}
