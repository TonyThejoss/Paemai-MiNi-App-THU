-- 0016 — สิทธิ์รายฟังก์ชัน + ย้อนรายการรับเงินโดยมีหลักฐานตรวจสอบ

alter table app_users add column if not exists permissions jsonb not null default '[]'::jsonb;
alter table app_users add column if not exists created_by text not null default '';

-- paemai เป็นบัญชีเจ้าของระบบและมีสิทธิ์ครบเสมอ
update app_users set role='admin', role_label='ผู้ดูแลระบบหลัก', permissions='["*"]'::jsonb
 where username='paemai';

-- รักษาการใช้งานของ admin เดิม แต่ไม่ให้สิทธิ์สร้างผู้ใช้/ลบธุรกรรมโดยอัตโนมัติ
update app_users set permissions='["dashboard","map","payments","electric","register_vendor","edit_vendor","leave","floating_queue","rules","reports","settings","activity_log"]'::jsonb
 where username<>'paemai' and role='admin' and permissions='[]'::jsonb;
update app_users set permissions='["dashboard","reports"]'::jsonb
 where role='viewer' and permissions='[]'::jsonb;

create table if not exists voided_payments (
  id               bigserial primary key,
  original_payment_id bigint not null,
  payment_snapshot jsonb not null,
  allocation_snapshot jsonb not null default '[]'::jsonb,
  reason           text not null,
  voided_by        text not null,
  voided_at        timestamptz not null default now()
);
create index if not exists voided_payments_recent_idx on voided_payments(voided_at desc);
alter table voided_payments enable row level security;
revoke all on voided_payments from public,anon,authenticated;

create or replace function public.user_has_permission(p_username text, p_permission text)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(
    select 1 from app_users u where u.username=p_username
      and (u.username='paemai' or u.permissions ? '*' or u.permissions ? p_permission)
  );
$$;
revoke all on function public.user_has_permission(text,text) from public,anon,authenticated;

create or replace function public.user_security_action(action text, payload jsonb, actor text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $security$
declare
  p jsonb:=coalesce(payload,'{}'::jsonb); d jsonb:=coalesce(payload->'data','{}'::jsonb);
  target_username text; target_role text; target_permissions jsonb; target_password text;
  pmt payments%rowtype; alloc jsonb; balance numeric;
begin
  if action='getUsers' then
    return jsonb_build_object('status','ok','data',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'username',u.username,'role',u.role,'displayName',u.display_name,
        'roleLabel',u.role_label,'permissions',u.permissions,'createdBy',u.created_by,
        'createdAt',u.created_at,'isOwner',u.username='paemai') order by u.username),'[]'::jsonb)
      from app_users u));
  end if;

  if action='saveUser' then
    target_username:=lower(trim(d->>'username'));
    target_role:=coalesce(nullif(d->>'role',''),'viewer');
    target_permissions:=coalesce(d->'permissions','[]'::jsonb);
    target_password:=coalesce(d->>'password','');
    if target_username !~ '^[a-z0-9._-]{3,30}$' then
      return jsonb_build_object('status','error','message','username ต้องยาว 3–30 ตัว และใช้ a-z 0-9 . _ - เท่านั้น');
    end if;
    if target_username='paemai' then
      return jsonb_build_object('status','error','message','บัญชี paemai แก้สิทธิ์จากหน้านี้ไม่ได้');
    end if;
    if target_role not in ('admin','viewer') or jsonb_typeof(target_permissions)<>'array' then
      return jsonb_build_object('status','error','message','ข้อมูลสิทธิ์ไม่ถูกต้อง');
    end if;
    if target_permissions ? '*' then
      return jsonb_build_object('status','error','message','สิทธิ์ครบทั้งหมดสงวนไว้สำหรับ paemai');
    end if;
    if target_role<>'admin' and target_permissions ? 'delete_payments' then
      return jsonb_build_object('status','error','message','สิทธิ์ลบธุรกรรมรับเงินกำหนดให้ Admin เท่านั้น');
    end if;
    if not exists(select 1 from app_users where username=target_username) and length(target_password)<8 then
      return jsonb_build_object('status','error','message','รหัสผ่านผู้ใช้ใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
    end if;
    insert into app_users(username,password_hash,role,display_name,role_label,permissions,created_by)
    values(target_username,crypt(target_password,gen_salt('bf',12)),target_role,
      coalesce(nullif(trim(d->>'displayName'),''),target_username),
      case when target_role='admin' then 'ผู้ดูแลระบบ' else 'ผู้ใช้งานตามสิทธิ์' end,
      target_permissions,actor)
    on conflict(username) do update set
      password_hash=case when target_password='' then app_users.password_hash else crypt(target_password,gen_salt('bf',12)) end,
      role=excluded.role,display_name=excluded.display_name,role_label=excluded.role_label,
      permissions=excluded.permissions,updated_at=now();
    delete from api_sessions where username=target_username;
    insert into activity_log(actor,type,message,detail)
      values(actor,'user_management','บันทึกบัญชีผู้ใช้: '||target_username,'role='||target_role||' permissions='||target_permissions::text);
    return jsonb_build_object('status','ok','data',jsonb_build_object('username',target_username));
  end if;

  if action='deleteUser' then
    target_username:=lower(trim(coalesce(d->>'username',p->>'username')));
    if target_username in ('','paemai') or target_username=actor then
      return jsonb_build_object('status','error','message','ไม่สามารถลบบัญชีหลักหรือบัญชีที่กำลังใช้งานอยู่');
    end if;
    delete from app_users where username=target_username;
    if not found then return jsonb_build_object('status','error','message','ไม่พบบัญชีผู้ใช้'); end if;
    insert into activity_log(actor,type,message,detail) values(actor,'user_management','ลบบัญชีผู้ใช้: '||target_username,'');
    return jsonb_build_object('status','ok','data',jsonb_build_object('deleted',target_username));
  end if;

  if action='reverseVendorPayment' then
    if length(trim(coalesce(d->>'reason',''))) < 4 then
      return jsonb_build_object('status','error','message','กรุณาระบุเหตุผลอย่างน้อย 4 ตัวอักษร');
    end if;
    select * into pmt from payments where id=(d->>'payment_id')::bigint for update;
    if not found or pmt.lease_id is null then
      return jsonb_build_object('status','error','message','ไม่พบรายการรับชำระผู้ค้าประจำ');
    end if;
    select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) into alloc
      from payment_allocations a where a.payment_id=pmt.id;
    perform 1 from vendor_charges c where c.lease_id=pmt.lease_id for update;
    update vendor_charges c set paid_amount=greatest(0,c.paid_amount-a.amount)
      from payment_allocations a where a.payment_id=pmt.id and a.charge_id=c.id;
    insert into voided_payments(original_payment_id,payment_snapshot,allocation_snapshot,reason,voided_by)
      values(pmt.id,to_jsonb(pmt),alloc,trim(d->>'reason'),actor);
    delete from payments where id=pmt.id;
    select coalesce(sum(amount-paid_amount),0) into balance from vendor_charges where lease_id=pmt.lease_id;
    -- ถ้าเป็นรายการของรอบเก่าที่ปิดแล้ว ห้ามเปลี่ยนสถานะผู้ค้าคนใหม่ซึ่งใช้ล็อคเดียวกันอยู่ตอนนี้
    update vendors set status=case when balance>0 then 'unpaid' else 'active' end
     where lock=pmt.lock_id and exists(
       select 1 from vendor_leases l where l.id=pmt.lease_id and l.ended_at is null);
    insert into activity_log(actor,type,message,detail)
      values(actor,'payment_void','ยกเลิกรายการรับเงิน #'||pmt.id||' ล็อค '||pmt.lock_id,
        'ยอด '||(pmt.amount+pmt.penalty+pmt.other_fee)||' · เหตุผล: '||trim(d->>'reason'));
    return jsonb_build_object('status','ok','data',jsonb_build_object(
      'payment_id',pmt.id,'restored_outstanding',balance,'lock_id',pmt.lock_id));
  end if;

  if action='getVoidedPayments' then
    return jsonb_build_object('status','ok','data',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'payment_id',original_payment_id,'payment',payment_snapshot,'reason',reason,
        'voided_by',voided_by,'voided_at',voided_at) order by voided_at desc),'[]'::jsonb)
      from voided_payments));
  end if;
  return jsonb_build_object('status','error','message','security action ไม่ถูกต้อง');
end;
$security$;
revoke all on function public.user_security_action(text,jsonb,text) from public,anon,authenticated;

-- แยกหนี้ค่าเช่ากับค่าไฟในเดือนแรก: ตรวจซ้ำตาม "ประเภท" ไม่ใช่เพียงมีหนี้อะไรก็ได้
-- เพื่อไม่ให้แถวค่าเช่าที่สร้างก่อนหน้าไปปิดกั้นการสร้างแถวค่าไฟในรอบเดียวกัน
create or replace function public.ensure_vendor_charges_split(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $charges$
declare
  p jsonb:=coalesce(payload,'{}'::jsonb); d jsonb:=coalesce(payload->'data','{}'::jsonb);
  v_row jsonb; v_lease vendor_leases%rowtype; v_month date; v_type text; v_amount numeric;
begin
  for v_row in select value from jsonb_array_elements(coalesce(d->'rows','[]'::jsonb)) loop
    select * into v_lease from vendor_leases where lock_id=v_row->>'lock_id' and ended_at is null;
    v_amount:=coalesce(nullif(v_row->>'amount','')::numeric,0);
    if found and v_amount>0 then
      v_month:=date_trunc('month',coalesce(th_date(v_row->>'billing_month'),current_date))::date;
      v_type:=coalesce(v_row->>'type','ค่าเช่าประจำเดือน');
      if v_month<>date_trunc('month',v_lease.started_on)::date
         or not exists(select 1 from vendor_charges c where c.lease_id=v_lease.id
              and c.billing_month=v_month and c.charge_type=v_type) then
        insert into vendor_charges(lease_id,lock_id,billing_month,charge_type,description,amount)
        values(v_lease.id,v_lease.lock_id,v_month,v_type,coalesce(v_row->>'description',''),v_amount)
        on conflict (lease_id,billing_month,charge_type,description) do update
          set amount=greatest(vendor_charges.amount,excluded.amount);
      end if;
    end if;
  end loop;
  update vendors v set status='unpaid' where v.status<>'terminated' and exists(
    select 1 from vendor_leases l join vendor_charges c on c.lease_id=l.id
     where l.lock_id=v.lock and l.ended_at is null and c.paid_amount<c.amount);
  return jsonb_build_object('status','ok','data',jsonb_build_object('ensured',true));
end;
$charges$;
revoke all on function public.ensure_vendor_charges_split(jsonb) from public,anon,authenticated;

-- API ด่านหน้า: อ่านสิทธิ์สดจาก app_users ทุกคำสั่ง เพื่อให้แก้สิทธิ์แล้วมีผลทันที
create or replace function public.api(action text, payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $api$
declare
  p jsonb:=coalesce(payload,'{}'::jsonb); raw jsonb; token text; v_hash text;
  session_username text; session_role text; session_permissions jsonb; v_exp timestamptz;
  account_actions constant text[]:=array['getVendorPaymentHistory','registerVendorAccount','ensureVendorCharges','recordVendorPayment','closeVendorLease'];
begin
  if action='getPublicStatus' then return public.api_legacy(action,p); end if;
  if action='verifyUser' then
    raw:=public.api_legacy(action,p);
    if coalesce(raw->>'status','')<>'ok' or raw->'data' is null then return raw; end if;
    select permissions into session_permissions from app_users where username=raw->'data'->>'username';
    raw:=jsonb_set(raw,'{data,permissions}',coalesce(session_permissions,'[]'::jsonb),true);
    raw:=jsonb_set(raw,'{data,isOwner}',to_jsonb((raw->'data'->>'username')='paemai'),true);
    token:=encode(gen_random_bytes(32),'hex'); v_hash:=encode(digest(token,'sha256'),'hex'); v_exp:=now()+interval '12 hours';
    insert into api_sessions(token_hash,username,role,expires_at)
      values(v_hash,raw->'data'->>'username',raw->'data'->>'role',v_exp);
    return jsonb_build_object('status','ok','data',jsonb_build_object('profile',raw->'data','sessionToken',token,'expiresAt',v_exp));
  end if;
  token:=coalesce(p->>'sessionToken','');
  if token='' then return jsonb_build_object('status','error','message','ต้องเข้าสู่ระบบก่อนใช้งาน'); end if;
  v_hash:=encode(digest(token,'sha256'),'hex');
  delete from api_sessions s where s.expires_at<=now();
  select u.username,u.role,u.permissions into session_username,session_role,session_permissions
    from api_sessions s join app_users u on u.username=s.username
   where s.token_hash=v_hash and s.expires_at>now();
  if not found then return jsonb_build_object('status','error','message','session หมดอายุหรือบัญชีถูกปิด กรุณาเข้าสู่ระบบใหม่'); end if;
  update api_sessions s set last_seen_at=now(),role=session_role where s.token_hash=v_hash;

  if action='changePassword' and coalesce(p->>'username','')<>session_username then
    return jsonb_build_object('status','error','message','เปลี่ยนรหัสผ่านได้เฉพาะบัญชีของตนเอง');
  end if;
  if action in ('getUsers','saveUser','deleteUser') and not public.user_has_permission(session_username,'manage_users') then
    return jsonb_build_object('status','error','message','ไม่มีสิทธิ์จัดการบัญชีผู้ใช้');
  end if;
  if action='reverseVendorPayment' and (session_role<>'admin' or not public.user_has_permission(session_username,'delete_payments')) then
    return jsonb_build_object('status','error','message','เฉพาะ admin ที่ได้รับสิทธิ์ลบธุรกรรมเท่านั้น');
  end if;
  if action='getVoidedPayments' and not (public.user_has_permission(session_username,'delete_payments') or public.user_has_permission(session_username,'activity_log')) then
    return jsonb_build_object('status','error','message','ไม่มีสิทธิ์ดูรายการที่ยกเลิก');
  end if;
  if action in ('getUsers','saveUser','deleteUser','reverseVendorPayment','getVoidedPayments') then
    return public.user_security_action(action,p,session_username);
  end if;

  if action in ('recordVendorPayment','ensureVendorCharges') and not public.user_has_permission(session_username,'payments') then
    return jsonb_build_object('status','error','message','ไม่มีสิทธิ์รับชำระเงิน');
  end if;
  if action='registerVendorAccount' and not public.user_has_permission(session_username,'register_vendor') then
    return jsonb_build_object('status','error','message','ไม่มีสิทธิ์ลงทะเบียนผู้ค้า');
  end if;
  if action='closeVendorLease' and not (public.user_has_permission(session_username,'edit_vendor') or public.user_has_permission(session_username,'map')) then
    return jsonb_build_object('status','error','message','ไม่มีสิทธิ์ยกเลิกการเช่า');
  end if;
  if action in ('savePayment') and not (public.user_has_permission(session_username,'electric') or public.user_has_permission(session_username,'payments')) then
    return jsonb_build_object('status','error','message','ไม่มีสิทธิ์บันทึกรับเงิน');
  end if;
  if action in ('saveVendor','deleteVendor','moveVendorLock') and not (
    public.user_has_permission(session_username,'edit_vendor') or public.user_has_permission(session_username,'electric') or public.user_has_permission(session_username,'register_vendor')) then
    return jsonb_build_object('status','error','message','ไม่มีสิทธิ์แก้ไขข้อมูลผู้ค้า');
  end if;
  if action in ('logLeave','clearLeaveForDate') and not (public.user_has_permission(session_username,'leave') or public.user_has_permission(session_username,'map')) then
    return jsonb_build_object('status','error','message','ไม่มีสิทธิ์จัดการลา/ขาดล็อค');
  end if;
  if action in ('saveDailyBooking','cancelDailyBooking','moveDailyBooking','saveFloatingQueueEntry','sellFloatingQueueEntry','editFloatingQueueEntry','cancelFloatingQueueEntry')
     and not public.user_has_permission(session_username,'floating_queue') then
    return jsonb_build_object('status','error','message','ไม่มีสิทธิ์จัดการล็อคจร');
  end if;
  if action='saveMarketRules' and not public.user_has_permission(session_username,'rules') then
    return jsonb_build_object('status','error','message','ไม่มีสิทธิ์แก้กฎตลาด');
  end if;
  if action in ('saveDiscount','deleteDiscount','saveSettings') and not public.user_has_permission(session_username,'settings') then
    return jsonb_build_object('status','error','message','ไม่มีสิทธิ์ตั้งค่าระบบ');
  end if;
  if action='getActivityLog' and not public.user_has_permission(session_username,'activity_log') then
    return jsonb_build_object('status','error','message','ไม่มีสิทธิ์ดูบันทึกกิจกรรม');
  end if;
  if action='getVendorAccounts' then
    return jsonb_build_object('status','ok','data',(
      select coalesce(jsonb_agg(x order by x.lock_id),'[]'::jsonb) from (
        select l.id lease_id,l.lock_id,l.zone,l.vendor_name,l.product,l.started_on,l.ended_at,
          coalesce(sum(c.amount-c.paid_amount),0) outstanding,
          coalesce(sum(c.amount-c.paid_amount) filter (where c.charge_type like '%ไฟ%'),0) outstanding_electric,
          coalesce(sum(c.amount-c.paid_amount) filter (where c.charge_type not like '%ไฟ%'),0) outstanding_non_electric
        from vendor_leases l left join vendor_charges c on c.lease_id=l.id
        where (coalesce(p->>'lockId','')='' or l.lock_id=p->>'lockId')
          and (coalesce(p->>'leaseId','')='' or l.id=(p->>'leaseId')::bigint)
          and (coalesce(p->>'includeClosed','false')='true' or l.ended_at is null)
        group by l.id) x));
  end if;
  if action='ensureVendorCharges' then return public.ensure_vendor_charges_split(p); end if;
  if action=any(account_actions) then return public.vendor_account_action(action,p); end if;
  if action in ('getInstallmentPlans','saveInstallmentPlan','deleteInstallmentPlan') then
    return jsonb_build_object('status','error','message','ระบบผ่อนชำระถูกยกเลิกแล้ว');
  end if;
  return public.api_legacy(action,p);
end;
$api$;

revoke all on function public.api(text,jsonb) from public;
grant execute on function public.api(text,jsonb) to anon,authenticated;
