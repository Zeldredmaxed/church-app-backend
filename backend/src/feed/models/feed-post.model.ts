import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType()
export class FeedAuthor {
  @Field(() => ID)
  id: string;

  @Field(() => String, { nullable: true })
  fullName: string | null;

  @Field(() => String, { nullable: true })
  avatarUrl: string | null;
}

@ObjectType()
export class FeedComment {
  @Field(() => ID)
  id: string;

  @Field()
  content: string;

  @Field()
  createdAt: Date;

  @Field(() => FeedAuthor)
  author: FeedAuthor;
}

@ObjectType()
export class FeedPost {
  @Field(() => ID)
  id: string;

  @Field()
  content: string;

  @Field()
  mediaType: string;

  @Field(() => String, { nullable: true })
  mediaUrl: string | null;

  @Field(() => String, { nullable: true })
  videoMuxPlaybackId: string | null;

  @Field()
  createdAt: Date;

  @Field(() => FeedAuthor)
  author: FeedAuthor;

  @Field(() => FeedComment, { nullable: true })
  latestComment: FeedComment | null;
}

@ObjectType()
export class PaginatedFeedResponse {
  @Field(() => [FeedPost])
  posts: FeedPost[];

  @Field()
  total: number;

  @Field()
  limit: number;

  @Field()
  offset: number;
}
