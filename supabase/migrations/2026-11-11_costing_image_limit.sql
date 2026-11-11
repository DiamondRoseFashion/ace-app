-- ============================================================
-- Costing sheet images: 300 KB maximum per image.
-- ACE already shrinks pasted / chosen pictures to fit; this makes the
-- storage folder itself refuse anything bigger, and only pictures.
-- Safe to run more than once.
-- ============================================================
update storage.buckets
   set file_size_limit = 307200, -- 300 KB
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'costing-images';

-- Shows the limit (should say 300 KB):
select id, (file_size_limit / 1024) || ' KB' as max_image_size from storage.buckets where id = 'costing-images';
