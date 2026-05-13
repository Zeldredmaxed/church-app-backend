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

  /**
   * Controls whether the mobile app shows an in-app banner/toast when a
   * notification arrives while the user has the app foregrounded. Push
   * notifications (above) are sent regardless; this is purely an in-app
   * rendering hint that the mobile reads when deciding whether to show
   * a banner over the current screen.
   */
  @Column({ type: 'boolean', name: 'in_app_notifications', default: true })
  inAppNotifications: boolean;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
