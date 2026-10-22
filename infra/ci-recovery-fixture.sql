-- CI-only disposable database fixture; not a demo seed or login account.
BEGIN;
INSERT INTO users(id,email,password_hash,display_name) VALUES
 ('10000000-0000-4000-8000-000000000001','seller@ci.invalid','not-login-capable','CI seller'),
 ('10000000-0000-4000-8000-000000000002','bidder@ci.invalid','not-login-capable','CI bidder');
INSERT INTO categories(id,slug,name) VALUES ('20000000-0000-4000-8000-000000000001','ci-recovery','CI recovery');
INSERT INTO auctions(id,seller_id,category_id,title,description,status,opening_price_vnd,current_price_vnd,minimum_increment_vnd,starts_at,ends_at,highest_bidder_id)
VALUES ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Recovery fixture','CI only','ENDED',100,150,10,now()-interval '2 hours',now()-interval '1 hour','10000000-0000-4000-8000-000000000002');
INSERT INTO bids(id,auction_id,bidder_id,amount_vnd,idempotency_key) VALUES ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',150,'50000000-0000-4000-8000-000000000001');
INSERT INTO auction_results(auction_id,winner_id,winning_bid_id,final_price_vnd) VALUES ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',150);
COMMIT;
