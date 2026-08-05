-- 0017 — ป้องกันค่าเช่า/ค่าไฟซ้ำ และให้บัญชีลูกหนี้เป็นแหล่งข้อมูลกลาง
-- สาเหตุเดิม: ผังตลาดสร้าง type="ยอดเรียกเก็บประจำเดือน" ขณะที่หน้ารับชำระสร้าง
-- type="ค่าเช่าประจำเดือน" ฐานข้อมูลจึงมองเป็นคนละรายการและบวกซ้ำ

alter table vendor_charges add column if not exists charge_code text;

create or replace function public.vendor_charge_code(p_type text)
returns text language sql immutable as $$
  select case
    when coalesce(p_type,'') like '%ไฟ%' then 'electric'
    when coalesce(p_type,'') like '%ค่าเช่า%'
      or coalesce(p_type,'') in ('ยอดเรียกเก็บประจำเดือน','ยอดรวมประจำเดือน') then 'rent'
    when coalesce(p_type,'') like '%รายปี%' then 'annual_fee'
    when coalesce(p_type,'') like '%แรกเข้า%' then 'entry_fee'
    else 'other'
  end
$$;

update vendor_charges set charge_code=public.vendor_charge_code(charge_type)
where charge_code is null or charge_code='';

-- เก็บหลักฐานเต็มก่อนรวมแถวซ้ำ ไม่ลบประวัติทิ้ง
create table if not exists vendor_charge_repair_archive (
  id bigserial primary key,
  repair_group text not null,
  original_charge jsonb not null,
  original_allocations jsonb not null default '[]'::jsonb,
  note text not null default '',
  archived_at timestamptz not null default now()
);
alter table vendor_charge_repair_archive enable row level security;
revoke all on vendor_charge_repair_archive from public,anon,authenticated;

do $repair$
declare
  g record; dup record; alloc record;
  canonical_id bigint; intended numeric; paid_total numeric; group_key text;
begin
  for g in
    select lease_id,billing_month,charge_code,count(*) n
    from vendor_charges where charge_code in ('rent','electric')
    group by lease_id,billing_month,charge_code having count(*)>1
  loop
    select min(id),max(amount),coalesce(sum(paid_amount),0)
      into canonical_id,intended,paid_total
      from vendor_charges
     where lease_id=g.lease_id and billing_month=g.billing_month and charge_code=g.charge_code;
    group_key:=g.lease_id||'/'||g.billing_month||'/'||g.charge_code;

    for dup in select * from vendor_charges
      where lease_id=g.lease_id and billing_month=g.billing_month
        and charge_code=g.charge_code and id<>canonical_id
    loop
      insert into vendor_charge_repair_archive(repair_group,original_charge,original_allocations,note)
      values(
        group_key,
        to_jsonb(dup),
        coalesce((select jsonb_agg(to_jsonb(a)) from payment_allocations a where a.charge_id=dup.id),'[]'::jsonb),
        case when paid_total>intended then 'ยอดรับรวมสูงกว่าหนี้ที่ควรมี คงหลักฐานรับเงินและตั้งยอดค้างเป็นศูนย์' else 'รวมแถวซ้ำโดยเก็บยอดที่ควรเรียกเก็บสูงสุดเพียงครั้งเดียว' end
      );

      for alloc in select * from payment_allocations where charge_id=dup.id loop
        insert into payment_allocations(payment_id,charge_id,amount)
        values(alloc.payment_id,canonical_id,alloc.amount)
        on conflict(payment_id,charge_id) do update
          set amount=payment_allocations.amount+excluded.amount;
      end loop;
      delete from payment_allocations where charge_id=dup.id;
      delete from vendor_charges where id=dup.id;
    end loop;

    -- ถ้ามีการรับเงินจากยอดซ้ำไปแล้ว ห้ามสร้างยอดติดลบหรือลบหลักฐานรับเงิน
    update vendor_charges
       set amount=greatest(intended,paid_total),paid_amount=paid_total,
           description=case g.charge_code when 'rent' then 'ค่าเช่าและค่าธรรมเนียมประจำเดือน' else 'ค่าไฟประจำเดือน' end,
           charge_type=case g.charge_code when 'rent' then 'ค่าเช่าประจำเดือน' else 'ค่าไฟฟ้า' end
     where id=canonical_id;
  end loop;
end
$repair$;

create unique index if not exists vendor_charge_component_once
  on vendor_charges(lease_id,billing_month,charge_code)
  where charge_code in ('rent','electric');

create or replace function public.set_vendor_charge_code()
returns trigger language plpgsql as $$
begin
  new.charge_code:=public.vendor_charge_code(new.charge_type);
  return new;
end
$$;
drop trigger if exists trg_vendor_charge_code on vendor_charges;
create trigger trg_vendor_charge_code before insert or update of charge_type on vendor_charges
for each row execute function public.set_vendor_charge_code();

-- ทางเดียวสำหรับออก/ปรับยอดรายเดือน: อัปเดตองค์ประกอบเดิม ห้ามเพิ่มแถวซ้ำ
create or replace function public.ensure_vendor_charges_split(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $charges$
declare
  d jsonb:=coalesce(payload->'data','{}'::jsonb);v_row jsonb;v_lease vendor_leases%rowtype;
  v_month date;v_type text;v_code text;v_amount numeric;v_existing vendor_charges%rowtype;
begin
  for v_row in select value from jsonb_array_elements(coalesce(d->'rows','[]'::jsonb)) loop
    select * into v_lease from vendor_leases where lock_id=v_row->>'lock_id' and ended_at is null for update;
    v_amount:=coalesce(nullif(v_row->>'amount','')::numeric,0);
    if found and v_amount>=0 then
      v_month:=date_trunc('month',coalesce(th_date(v_row->>'billing_month'),current_date))::date;
      v_type:=coalesce(v_row->>'type','ค่าเช่าประจำเดือน');v_code:=public.vendor_charge_code(v_type);
      select * into v_existing from vendor_charges
       where lease_id=v_lease.id and billing_month=v_month and charge_code=v_code
         and v_code in ('rent','electric') for update;
      if found then
        -- ยอดที่ออกแล้วปรับตามส่วนลด/ค่าไฟล่าสุดได้ แต่ห้ามลดต่ำกว่ายอดที่รับไปแล้ว
        update vendor_charges set amount=greatest(v_amount,paid_amount),charge_type=v_type,
          description=coalesce(v_row->>'description','') where id=v_existing.id;
      elsif v_amount>0 then
        -- เดือนแรกใช้ยอดเปิดบัญชีจากหน้าลงทะเบียน ถ้ามี component เดียวกันแล้ว trigger/index จะกันซ้ำ
        insert into vendor_charges(lease_id,lock_id,billing_month,charge_type,description,amount,charge_code)
        values(v_lease.id,v_lease.lock_id,v_month,v_type,coalesce(v_row->>'description',''),v_amount,v_code)
        on conflict do nothing;
      end if;
    end if;
  end loop;
  update vendors v set status=case when exists(
    select 1 from vendor_leases l join vendor_charges c on c.lease_id=l.id
    where l.lock_id=v.lock and l.ended_at is null and c.paid_amount<c.amount) then 'unpaid' else 'active' end
  where v.status<>'terminated';
  return jsonb_build_object('status','ok','data',jsonb_build_object('ensured',true));
end
$charges$;
revoke all on function public.ensure_vendor_charges_split(jsonb) from public,anon,authenticated;

-- เพิ่มองค์ประกอบยอดรับในประวัติ ให้รายงานค่าไฟไม่ต้องเดาจาก payments.type
alter function public.vendor_account_action(text,jsonb) rename to vendor_account_action_before_0017;

create or replace function public.vendor_account_action(action text,payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $account_wrapper$
declare p jsonb:=coalesce(payload,'{}'::jsonb);result_data jsonb;
begin
  if action='getVendorPaymentHistory' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',pmt.id,'lease_id',pmt.lease_id,'lock_id',pmt.lock_id,
      'vendor_name',pmt.vendor_name,'product',pmt.product,'type',pmt.type,
      'amount',pmt.amount+pmt.penalty+pmt.other_fee,
      'electric_amount',coalesce(parts.electric_amount,0),
      'non_electric_amount',coalesce(parts.non_electric_amount,0),
      'method',pmt.method,'note',pmt.note,'date',th_fmt(pmt.paid_date),
      'date_iso',pmt.paid_date,'time',pmt.paid_time)
      order by pmt.paid_date desc,pmt.id desc),'[]'::jsonb) into result_data
    from payments pmt
    left join lateral(
      select
        coalesce(sum(a.amount) filter(where c.charge_code='electric'),0) electric_amount,
        coalesce(sum(a.amount) filter(where c.charge_code<>'electric'),0) non_electric_amount
      from payment_allocations a join vendor_charges c on c.id=a.charge_id
      where a.payment_id=pmt.id
    ) parts on true
    where (coalesce(p->>'lockId','')='' or pmt.lock_id=p->>'lockId')
      and (coalesce(p->>'leaseId','')='' or pmt.lease_id=(p->>'leaseId')::bigint)
      and date_matches(pmt.paid_date,p);
    return jsonb_build_object('status','ok','data',result_data);
  end if;
  return public.vendor_account_action_before_0017(action,payload);
end
$account_wrapper$;
revoke all on function public.vendor_account_action(text,jsonb) from public,anon,authenticated;
