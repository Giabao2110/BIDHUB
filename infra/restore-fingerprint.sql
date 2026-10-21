-- Stable content fingerprints, not just row counts. No row contents are printed.
SELECT name, count(*), md5(COALESCE(string_agg(row_data, E'\n' ORDER BY row_data), ''))
FROM (
  SELECT 'users' AS name, row_to_json(t)::text AS row_data FROM users t
  UNION ALL SELECT 'sessions', row_to_json(t)::text FROM sessions t
  UNION ALL SELECT 'categories', row_to_json(t)::text FROM categories t
  UNION ALL SELECT 'auctions', row_to_json(t)::text FROM auctions t
  UNION ALL SELECT 'bids', row_to_json(t)::text FROM bids t
  UNION ALL SELECT 'auction_results', row_to_json(t)::text FROM auction_results t
  UNION ALL SELECT 'watchlists', row_to_json(t)::text FROM watchlists t
  UNION ALL SELECT 'audit_logs', row_to_json(t)::text FROM audit_logs t
  UNION ALL SELECT 'schema_migrations', row_to_json(t)::text FROM schema_migrations t
) rows GROUP BY name ORDER BY name;
