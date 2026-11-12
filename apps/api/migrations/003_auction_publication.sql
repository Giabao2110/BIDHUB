-- Legacy cancelled rows have no reliable publication history. Leave them private.
ALTER TABLE auctions ADD COLUMN was_published boolean NOT NULL DEFAULT false;

UPDATE auctions
SET was_published = true
WHERE status IN ('SCHEDULED', 'ACTIVE', 'ENDED');
