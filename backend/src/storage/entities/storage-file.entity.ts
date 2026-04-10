import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'storage_files' })
export class StorageFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'text', name: 'file_key' })
  fileKey: string;

  @Column({ type: 'bigint', name: 'file_size_bytes' })
  fileSizeBytes: string; // bigint comes back as string from pg

  @Column({ type: 'text', name: 'content_type' })
  contentType: string;

  @Column({ type: 'text', name: 'source_type', default: 'upload' })
  sourceType: string;

  @Column({ type: 'uuid', name: 'source_id', nullable: true })
  sourceId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
