import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'user_settings' })
export class UserSettings {
  @PrimaryColumn('uuid', { name: 'user_id' })
  userId: string;

  @Column({ type: 'boolean', name: 'email_notifications', default: true })
  emailNotifications: boolean;

  @Column({ type: 'boolean', name: 'push_notifications', default: true })
  pushNotifications: boolean;

  @Column({ type: 'boolean', name: 'sms_notifications', default: false })
  smsNotifications: boolean;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
