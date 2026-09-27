-- Backups are now .zip files (manifest.json + the raw media files). Snapshots already saved as .json stay
-- readable and restorable, so application/json remains allowed.
-- The size limit is unchanged: 45 MB (47185920 bytes), the same as the check on compasso_backups.bytes and
-- CLOUD_BACKUP_LIMIT in src/backup.ts. Change all three together.
-- Row level security is untouched: every table and storage policy from 001 still applies as before.
update storage.buckets
set allowed_mime_types = array['application/json', 'application/zip'],
    file_size_limit = 47185920
where id = 'compasso-backups';
