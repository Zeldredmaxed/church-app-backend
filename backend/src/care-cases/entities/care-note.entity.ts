import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { CareCase } from './care-case.entity';

@Entity({ schema: 'public', name: 'care_notes' })
export class CareNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'care_case_id' })
  careCaseId: string;

  @ManyToOne(() => CareCase, { eager: false })
  @JoinColumn({ name: 'care_case_id' })
  careCase?: CareCase;

  @Column({ type: 'uuid', name: 'author_id' })
  authorId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'author_id' })
  author?: User;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
