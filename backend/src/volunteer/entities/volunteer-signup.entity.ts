import { Entity, Column, CreateDateColumn, PrimaryColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'volunteer_signups' })
export class VolunteerSignup {
  @PrimaryColumn({ type: 'uuid', name: 'opportunity_id' })
  opportunityId: string;

  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
