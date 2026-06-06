import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'ai_messages' })
export class AiMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId: string;

  @Column({ type: 'text' })
  role: 'user' | 'assistant';

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'int', nullable: true, name: 'tokens_input' })
  tokensInput: number | null;

  @Column({ type: 'int', nullable: true, name: 'tokens_output' })
  tokensOutput: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
