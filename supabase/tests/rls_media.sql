\set ON_ERROR_STOP on
set role authenticated;
-- A(대표, t1): 기사 C가 배정된 시공 건에 사진 등록
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select id as t1 from public.tenant where slug = 'nanomaster' \gset
select j.id as job_c, j.contract_id as con_c from public.job j join public.technician t on t.id = j.technician_id
  where t.profile_id = 'c0000000-0000-4000-8000-000000000003' and j.deleted_at is null order by j.created_at limit 1 \gset
select j.id as job_other from public.job j left join public.technician t on t.id = j.technician_id
  where coalesce(t.profile_id, '00000000-0000-4000-8000-000000000000') <> 'c0000000-0000-4000-8000-000000000003' and j.deleted_at is null limit 1 \gset
insert into public.media_asset (tenant_id, job_id, kind, path, mime) values (:'t1', :'job_c', 'before', :'t1' || '/202609/a1.jpg', 'image/jpeg') returning id as m1 \gset
do $$ begin
  if (select contract_id from public.media_asset where path like '%/a1.jpg') is null then raise exception 'contract not auto-filled'; end if;
  if (select customer_id from public.media_asset where path like '%/a1.jpg') is null then raise exception 'customer not auto-filled'; end if;
  if (select uploaded_by from public.media_asset where path like '%/a1.jpg') <> auth.uid() then raise exception 'uploaded_by'; end if;
end $$;
-- 대표는 발행 권한이 있어 마케팅 사용을 켤 수 있다
update public.media_asset set marketing_ok = true where id = :'m1';
-- C(기사, own): 본인 배정 시공의 사진은 보이고, 본인 사진을 올릴 수 있으며, 남의 사진은 못 고치고 마케팅 사용도 못 켠다
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
do $$ begin
  if (select count(*) from public.media_asset) <> 1 then raise exception 'C should see photo of own job'; end if;
end $$;
insert into public.media_asset (tenant_id, job_id, kind, path, mime) values (:'t1', :'job_c', 'after', :'t1' || '/202609/c1.jpg', 'image/jpeg');
do $$ begin
  update public.media_asset set caption = 'x' where path like '%/a1.jpg';
  if (select caption from public.media_asset where path like '%/a1.jpg') = 'x' then raise exception 'C edited A photo'; end if;
  begin
    update public.media_asset set marketing_ok = true where path like '%/c1.jpg';
    raise exception 'C turned on marketing_ok';
  exception when insufficient_privilege then null; end;
end $$;
-- 기사 본인 소유의 낱장 사진(영수증 등)은 올릴 수 있다
insert into public.media_asset (tenant_id, kind, path) values (:'t1', 'receipt', :'t1' || '/202609/c-receipt.jpg');
-- 남의 시공 건에는 못 붙인다
select set_config('test.job_other', :'job_other', false);
do $$ begin
  begin
    insert into public.media_asset (tenant_id, job_id, kind, path) values ((select id from public.tenant where slug = 'nanomaster'), current_setting('test.job_other')::uuid, 'after', 'x/other.jpg');
    raise exception 'C attached a photo to another technician job';
  exception when insufficient_privilege then null; end;
end $$;
-- 후기·콘텐츠: 사무(E)는 만들 수 있지만 승인·발행은 못 한다. 대표는 된다.
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000005', false);
insert into public.review (tenant_id, contract_id, rating, body, author_name, consent_marketing) values (:'t1', :'con_c', 5, '깔끔하게 잘 해주셨어요', '김○○', true) returning id as r1 \gset
insert into public.content_post (tenant_id, kind, title, body, review_id) values (:'t1', 'instagram', '주방 코팅 후기', '#집대리 #입주청소', :'r1') returning id as p1 \gset
do $$ begin
  if (select consent_at from public.review) is null then raise exception 'consent_at not set'; end if;
  begin
    update public.review set status = 'approved';
    raise exception 'E approved review';
  exception when insufficient_privilege then null; end;
  begin
    update public.content_post set status = 'published';
    raise exception 'E published content';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
update public.review set status = 'approved', response = '감사합니다' where id = :'r1';
update public.content_post set status = 'published', published_url = 'https://instagram.com/p/x' where id = :'p1';
do $$ begin
  if (select responded_at from public.review) is null then raise exception 'responded_at'; end if;
  if (select published_at from public.content_post) is null then raise exception 'published_at'; end if;
  if (select count(*) from public.media_asset) <> 3 then raise exception 'A should see 3 photos'; end if;
end $$;
-- G(t2 전용): 아무것도 안 보임
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000007', false);
do $$ begin
  if (select count(*) from public.media_asset) + (select count(*) from public.review) + (select count(*) from public.content_post) <> 0 then raise exception 'G sees t1 content'; end if;
end $$;
-- 푸시 구독은 본인 것만
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
insert into public.push_subscription (profile_id, endpoint, keys) values (auth.uid(), 'https://push.example/1', '{"p256dh":"x","auth":"y"}');
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
do $$ begin
  if (select count(*) from public.push_subscription) <> 0 then raise exception 'A sees C push subscription'; end if;
end $$;
reset role;
select 'RLS media tests passed' as result;
