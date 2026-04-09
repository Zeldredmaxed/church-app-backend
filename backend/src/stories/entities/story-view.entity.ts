import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity({ schema: 'public', name: 'story_views' })
export class StoryView {
  @PrimaryColumn('uuid', { name: 'story_id' })
  storyId: string;

  @PrimaryColumn('uuid', { name: 'viewer_id' })
  viewerId: string;

  @Column({ type: 'timestamptz', name: 'viewed_at', default: () => 'now()' })
  viewedAt: Date;
}
