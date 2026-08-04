-- 0015 — บัญชียอดค้างผู้ค้าประจำแยกตามรอบการเช่า
-- กติกา:
--   * สัญญาไม่มีวันสิ้นสุดล่วงหน้า; ended_at มีค่าเมื่อกดยกเลิกเช่าเท่านั้น
--   * ลงทะเบียน = สร้างยอดค้าง ไม่ใช่รับชำระ
--   * รับชำระหักยอดค้างเก่าสุดก่อน และห้ามรับเกินยอดที่ฐานข้อมูล
--   * ประวัติผู้ค้าเก่าไม่ปะปนกับผู้ค้าใหม่ในล็อคเดียวกัน

create table if not exists vendor_leases (
  id          bigserial primary key,
  lock_id     text not null,
  zone        text not null default '',
  vendor_name text not null default '',
  product     text not null default '',
  started_on  date not null default current_date,
  ended_at    timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists vendor_one_open_lease_per_lock
  on vendor_leases(lock_id) where ended_at is null;
create index if not exists vendor_leases_lock_idx on vendor_leases(lock_id, created_at desc);

create table if not exists vendor_charges (
  id            bigserial primary key,
  lease_id      bigint not null references vendor_leases(id) on delete restrict,
  lock_id       text not null,
  billing_month date not null,
  charge_type   text not null,
  description   text not null default '',
  amount        numeric(12,2) not null check (amount >= 0),
  paid_amount   numeric(12,2) not null default 0 check (paid_amount >= 0 and paid_amount <= amount),
  created_at    timestamptz not null default now(),
  constraint vendor_charge_once unique(lease_id, billing_month, charge_type, description)
);
create index if not exists vendor_charges_open_idx
  on vendor_charges(lease_id, billing_month, id) where paid_amount < amount;

alter table payments add column if not exists lease_id bigint references vendor_leases(id) on delete restrict;

create table if not exists payment_allocations (
  id         bigserial primary key,
  payment_id bigint not null references payments(id) on delete cascade,
  charge_id  bigint not null references vendor_charges(id) on delete restrict,
  amount     numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  constraint payment_charge_once unique(payment_id, charge_id)
);

alter table vendor_leases enable row level security;
alter table vendor_charges enable row level security;
alter table payment_allocations enable row level security;
revoke all on vendor_leases, vendor_charges, payment_allocations from public, anon, authenticated;

-- สร้างรอบเช่าปัจจุบันให้ข้อมูลเก่า โดยไม่สร้างหนี้ย้อนหลังเอง
insert into vendor_leases(lock_id, zone, vendor_name, product, started_on)
select v.lock, v.zone, v.name, v.product, current_date
  from vendors v
 where v.status <> 'terminated'
   and not exists (select 1 from vendor_leases l where l.lock_id=v.lock and l.ended_at is null);

-- ผู้ค้าเก่าที่มีแผนผ่อน: โอนยอดคงเหลือที่คำนวณได้เข้ายอดค้างปกติ
insert into vendor_charges(lease_id, lock_id, billing_month, charge_type, description, amount)
select l.id, l.lock_id, date_trunc('month', coalesce(ip.start_date,current_date))::date,
       'ยอดคงเหลือจากระบบผ่อนเดิม', 'ย้ายมาจากแผนผ่อนชำระ',
       greatest(coalesce(ip.first_amount,0) - coalesce((
         select sum(p.amount+p.penalty+p.other_fee) from payments p
          where p.lock_id=ip.lock_id and p.type='installment'
       ),0),0)
  from installment_plans ip
  join vendor_leases l on l.lock_id=ip.lock_id and l.ended_at is null
 where ip.status='active' and coalesce(ip.first_amount,0)>0
on conflict do nothing;

-- หลังโอนแล้วเลิกใช้ฟีเจอร์ผ่อนถาวร แต่เก็บตารางเดิมไว้เป็น archive
-- เพราะ api_legacy รุ่นเก่ายังอ้างชื่อตารางนี้อยู่; API ด่านหน้าด้านล่างปิดทุก action แล้ว
update installment_plans set status='retired' where status<>'retired';

create or replace function public.vendor_account_action(action text, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $account$
declare
  p jsonb := coalesce(payload,'{}'::jsonb);
  d jsonb := coalesce(payload->'data','{}'::jsonb);
  v_lease vendor_leases%rowtype;
  v_charge vendor_charges%rowtype;
  v_amount numeric;
  v_balance numeric;
  v_take numeric;
  v_payment_id bigint;
  v_row jsonb;
  v_started date;
  result_data jsonb;
begin
  if action = 'getVendorAccounts' then
    select coalesce(jsonb_agg(x order by x.lock_id), '[]'::jsonb) into result_data
      from (
        select l.id as lease_id, l.lock_id, l.zone, l.vendor_name, l.product,
               l.started_on, l.ended_at,
               coalesce(sum(c.amount-c.paid_amount),0) as outstanding
          from vendor_leases l
          left join vendor_charges c on c.lease_id=l.id
         where (coalesce(p->>'lockId','')='' or l.lock_id=p->>'lockId')
           and (coalesce(p->>'leaseId','')='' or l.id=(p->>'leaseId')::bigint)
           and (coalesce(p->>'includeClosed','false')='true' or l.ended_at is null)
         group by l.id
      ) x;
    return jsonb_build_object('status','ok','data',result_data);
  end if;

  if action = 'getVendorPaymentHistory' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',pmt.id,'lease_id',pmt.lease_id,'lock_id',pmt.lock_id,
      'vendor_name',pmt.vendor_name,'product',pmt.product,'type',pmt.type,
      'amount',pmt.amount+pmt.penalty+pmt.other_fee,'method',pmt.method,
      'note',pmt.note,'date',th_fmt(pmt.paid_date),'date_iso',pmt.paid_date,
      'time',pmt.paid_time) order by pmt.paid_date desc,pmt.id desc),'[]'::jsonb)
      into result_data
      from payments pmt
     where (coalesce(p->>'lockId','')='' or pmt.lock_id=p->>'lockId')
       and (coalesce(p->>'leaseId','')='' or pmt.lease_id=(p->>'leaseId')::bigint)
       and date_matches(pmt.paid_date,p);
    return jsonb_build_object('status','ok','data',result_data);
  end if;

  if action = 'registerVendorAccount' then
    perform public.api_legacy('saveVendor', p);
    v_started := coalesce(th_date(d->>'start_date'),current_date);
    select * into v_lease from vendor_leases
     where lock_id=d->>'lock' and ended_at is null for update;
    if not found then
      insert into vendor_leases(lock_id,zone,vendor_name,product,started_on)
      values(d->>'lock',coalesce(d->>'zone',''),coalesce(d->>'name',''),
             coalesce(d->>'product',''),v_started) returning * into v_lease;
    else
      update vendor_leases set zone=coalesce(d->>'zone',zone),
        vendor_name=coalesce(d->>'name',vendor_name),product=coalesce(d->>'product',product),
        updated_at=now() where id=v_lease.id returning * into v_lease;
    end if;
    for v_row in select value from jsonb_array_elements(coalesce(d->'charges','[]'::jsonb)) loop
      v_amount := coalesce(nullif(v_row->>'amount','')::numeric,0);
      if v_amount > 0 then
        insert into vendor_charges(lease_id,lock_id,billing_month,charge_type,description,amount)
        values(v_lease.id,v_lease.lock_id,date_trunc('month',v_started)::date,
               coalesce(v_row->>'type','ค่าใช้จ่าย'),coalesce(v_row->>'description',''),v_amount)
        on conflict do nothing;
      end if;
    end loop;
    select coalesce(sum(amount-paid_amount),0) into v_balance from vendor_charges where lease_id=v_lease.id;
    update vendors set status=case when v_balance>0 then 'unpaid' else 'active' end where lock=v_lease.lock_id;
    return jsonb_build_object('status','ok','data',jsonb_build_object('lease_id',v_lease.id,'outstanding',v_balance));
  end if;

  if action = 'ensureVendorCharges' then
    for v_row in select value from jsonb_array_elements(coalesce(d->'rows','[]'::jsonb)) loop
      select * into v_lease from vendor_leases
       where lock_id=v_row->>'lock_id' and ended_at is null;
      if found and coalesce(nullif(v_row->>'amount','')::numeric,0)>0 then
        -- เดือนแรกมียอดเปิดบัญชีจากหน้าลงทะเบียนอยู่แล้ว ห้ามสร้างบิลซ้ำ
        if date_trunc('month',coalesce(th_date(v_row->>'billing_month'),current_date))::date
             <> date_trunc('month',v_lease.started_on)::date
           or not exists(select 1 from vendor_charges c where c.lease_id=v_lease.id
             and c.billing_month=date_trunc('month',v_lease.started_on)::date) then
          insert into vendor_charges(lease_id,lock_id,billing_month,charge_type,description,amount)
          values(v_lease.id,v_lease.lock_id,
            date_trunc('month',coalesce(th_date(v_row->>'billing_month'),current_date))::date,
            coalesce(v_row->>'type','ค่าเช่าประจำเดือน'),coalesce(v_row->>'description',''),
            (v_row->>'amount')::numeric)
          on conflict (lease_id,billing_month,charge_type,description) do update
            set amount=greatest(vendor_charges.amount,excluded.amount);
        end if;
      end if;
    end loop;
    update vendors v set status='unpaid'
     where v.status<>'terminated' and exists(
       select 1 from vendor_leases l join vendor_charges c on c.lease_id=l.id
        where l.lock_id=v.lock and l.ended_at is null and c.paid_amount<c.amount);
    return jsonb_build_object('status','ok','data',jsonb_build_object('ensured',true));
  end if;

  if action = 'recordVendorPayment' then
    v_amount := coalesce(nullif(d->>'amount','')::numeric,0);
    if v_amount<=0 then return jsonb_build_object('status','error','message','จำนวนเงินต้องมากกว่า 0'); end if;
    if coalesce(d->>'method','') not in ('เงินสด','โอนเงิน') then
      return jsonb_build_object('status','error','message','ช่องทางชำระต้องเป็นเงินสดหรือโอนเงิน');
    end if;
    select * into v_lease from vendor_leases
     where lock_id=d->>'lock_id' and ended_at is null for update;
    if not found then return jsonb_build_object('status','error','message','ไม่พบรอบการเช่าปัจจุบัน'); end if;
    -- ล็อกแถวลูกหนี้ก่อนรวมยอด กันพนักงานสองคนรับชำระพร้อมกันแล้วเกินยอด
    perform 1 from vendor_charges where lease_id=v_lease.id for update;
    select coalesce(sum(amount-paid_amount),0) into v_balance
      from vendor_charges where lease_id=v_lease.id;
    if v_amount>v_balance then
      return jsonb_build_object('status','error','message','รับชำระเกินยอดค้างไม่ได้','outstanding',v_balance);
    end if;
    insert into payments(lock_id,vendor_name,product,type,amount,penalty,other_fee,other_label,
                         method,note,paid_date,paid_time,lease_id)
    values(v_lease.lock_id,v_lease.vendor_name,v_lease.product,'รับชำระผู้ค้าประจำ',v_amount,0,0,'',d->>'method',
           coalesce(d->>'note',''),coalesce(th_date(d->>'date'),current_date),coalesce(d->>'time',''),v_lease.id)
    returning id into v_payment_id;
    v_balance := v_amount;
    for v_charge in select * from vendor_charges
      where lease_id=v_lease.id and paid_amount<amount
      order by billing_month,id for update
    loop
      exit when v_balance<=0;
      v_take := least(v_balance,v_charge.amount-v_charge.paid_amount);
      update vendor_charges set paid_amount=paid_amount+v_take where id=v_charge.id;
      insert into payment_allocations(payment_id,charge_id,amount) values(v_payment_id,v_charge.id,v_take);
      v_balance := v_balance-v_take;
    end loop;
    select coalesce(sum(amount-paid_amount),0) into v_balance from vendor_charges where lease_id=v_lease.id;
    update vendors set status=case when v_balance=0 then 'active' else 'unpaid' end,
      unpaid_penalty=case when v_balance=0 then 0 else unpaid_penalty end,
      unpaid_other=case when v_balance=0 then 0 else unpaid_other end,
      unpaid_other_label=case when v_balance=0 then '' else unpaid_other_label end
      where lock=v_lease.lock_id;
    return jsonb_build_object('status','ok','data',jsonb_build_object(
      'payment_id',v_payment_id,'paid',v_amount,'outstanding',v_balance,'lease_id',v_lease.id));
  end if;

  if action = 'closeVendorLease' then
    select * into v_lease from vendor_leases where lock_id=d->>'lock_id' and ended_at is null for update;
    if not found then return jsonb_build_object('status','error','message','ไม่พบรอบการเช่าปัจจุบัน'); end if;
    select coalesce(sum(amount-paid_amount),0) into v_balance from vendor_charges where lease_id=v_lease.id;
    if v_balance>0 then return jsonb_build_object('status','error','message','ยกเลิกการเช่าไม่ได้ — ต้องปิดยอดค้างก่อน','outstanding',v_balance); end if;
    update vendor_leases set ended_at=now(),updated_at=now() where id=v_lease.id;
    perform public.api_legacy('deleteVendor',jsonb_build_object('lockId',v_lease.lock_id));
    return jsonb_build_object('status','ok','data',jsonb_build_object('closed',v_lease.id));
  end if;

  return jsonb_build_object('status','error','message','account action ไม่ถูกต้อง');
end;
$account$;

revoke all on function public.vendor_account_action(text,jsonb) from public,anon,authenticated;

-- ครอบ API ด่านหน้าตัวเดิม: ตรวจ session/role ก่อนเรียกบัญชีใหม่
create or replace function public.api(action text, payload jsonb default '{}'::jsonb)
returns jsonb
as $api$
declare
  p jsonb := coalesce(payload,'{}'::jsonb); raw jsonb; token text; v_hash text;
  session_username text; session_role text; v_exp timestamptz;
  read_actions constant text[] := array[
    'getVendors','getLeaveLog','getDailyBookings','getPayments','getFloatingQueue',
    'getMarketRules','getSettings','getDiscounts','getActivityLog','getCancellations',
    'getVendorAccounts','getVendorPaymentHistory'
  ];
  account_actions constant text[] := array[
    'getVendorAccounts','getVendorPaymentHistory','registerVendorAccount',
    'ensureVendorCharges','recordVendorPayment','closeVendorLease'
  ];
begin
  if action='getPublicStatus' then return public.api_legacy(action,p); end if;
  if action='verifyUser' then
    raw:=public.api_legacy(action,p);
    if coalesce(raw->>'status','')<>'ok' or raw->'data' is null then return raw; end if;
    token:=encode(gen_random_bytes(32),'hex'); v_hash:=encode(digest(token,'sha256'),'hex');
    v_exp:=now()+interval '12 hours';
    insert into api_sessions(token_hash,username,role,expires_at)
    values(v_hash,raw->'data'->>'username',raw->'data'->>'role',v_exp);
    return jsonb_build_object('status','ok','data',jsonb_build_object(
      'profile',raw->'data','sessionToken',token,'expiresAt',v_exp));
  end if;
  token:=coalesce(p->>'sessionToken','');
  if token='' then return jsonb_build_object('status','error','message','ต้องเข้าสู่ระบบก่อนใช้งาน'); end if;
  v_hash:=encode(digest(token,'sha256'),'hex');
  delete from api_sessions s where s.expires_at<=now();
  select s.username,s.role into session_username,session_role from api_sessions s
   where s.token_hash=v_hash and s.expires_at>now();
  if not found then return jsonb_build_object('status','error','message','session หมดอายุ กรุณาเข้าสู่ระบบใหม่'); end if;
  update api_sessions s set last_seen_at=now() where s.token_hash=v_hash;
  if session_role='viewer' and action<>all(read_actions) and action not in ('changePassword','logActivity') then
    return jsonb_build_object('status','error','message','บัญชีนี้ไม่มีสิทธิ์แก้ไขข้อมูล');
  end if;
  if action='changePassword' and coalesce(p->>'username','')<>session_username then
    return jsonb_build_object('status','error','message','เปลี่ยนรหัสผ่านได้เฉพาะบัญชีของตนเอง');
  end if;
  if action=any(account_actions) then return public.vendor_account_action(action,p); end if;
  if action in ('getInstallmentPlans','saveInstallmentPlan','deleteInstallmentPlan') then
    return jsonb_build_object('status','error','message','ระบบผ่อนชำระถูกยกเลิกแล้ว');
  end if;
  return public.api_legacy(action,p);
end;
$api$ language plpgsql security definer set search_path=public,extensions;

revoke all on function public.api(text,jsonb) from public;
grant execute on function public.api(text,jsonb) to anon,authenticated;
