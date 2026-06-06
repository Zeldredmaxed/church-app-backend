-- 078: Denormalize like_count + comment_count on posts via triggers
--
-- posts.getPosts currently runs 4 correlated subqueries per row (two
-- LATERAL COUNT joins + two EXISTS checks). A 20-row page = ~80
-- subqueries; P95 latency dominates the feed once comments table
-- grows past 100k rows.
--
-- We add denormalized like_count + comment_count columns on posts,
-- backfill from the source tables, and install AFTER INSERT/DELETE
-- triggers to keep them current. The feed query then reads p.like_count
-- + p.comment_count directly. The is_liked_by_me / is_saved_by_me
-- EXISTS checks remain (they're per-row + cheap on the partial index).

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS like_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comment_count INT NOT NULL DEFAULT 0;

-- Backfill from current state. Safe to re-run.
UPDATE public.posts p
SET like_count = (SELECT COUNT(*)::int FROM public.post_likes WHERE post_id = p.id),
    comment_count = (SELECT COUNT(*)::int FROM public.comments WHERE post_id = p.id);

-- Like triggers
CREATE OR REPLACE FUNCTION public.posts_increment_like_count() RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.posts_decrement_like_count() RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.posts SET like_count = GREATEST(0, like_count - 1) WHERE id = OLD.post_id;
  RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_posts_inc_like_count ON public.post_likes;
CREATE TRIGGER trg_posts_inc_like_count
  AFTER INSERT ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.posts_increment_like_count();

DROP TRIGGER IF EXISTS trg_posts_dec_like_count ON public.post_likes;
CREATE TRIGGER trg_posts_dec_like_count
  AFTER DELETE ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.posts_decrement_like_count();

-- Comment triggers
CREATE OR REPLACE FUNCTION public.posts_increment_comment_count() RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.posts_decrement_comment_count() RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.post_id;
  RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_posts_inc_comment_count ON public.comments;
CREATE TRIGGER trg_posts_inc_comment_count
  AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.posts_increment_comment_count();

DROP TRIGGER IF EXISTS trg_posts_dec_comment_count ON public.comments;
CREATE TRIGGER trg_posts_dec_comment_count
  AFTER DELETE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.posts_decrement_comment_count();
