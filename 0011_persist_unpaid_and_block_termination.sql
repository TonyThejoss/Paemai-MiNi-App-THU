-- 0011 — สถานะค้างชำระเป็นสถานะถาวรจนกว่าจะปิดยอด
-- ใช้กับทั้งสองโปรเจกต์หลัง 0010
--
-- กฎธุรกิจ:
-- 1) วงจรสถานะรายวัน 3 วันไม่เกี่ยวกับ vendors.status='unpaid'
-- 2) ห้ามสิ้นสุดสัญญาขณะที่สถานะยัง unpaid หรือยังมียอดค้าง
-- 3) การเปลี่ยน unpaid -> active ทำได้เมื่อยอดค้างตัวเลขถูกปิดเป็นศูนย์แล้วเท่านั้น

create or replace function public.guard_vendor_unpaid_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'terminated'
     and (old.status = 'unpaid'
          or coalesce(old.unpaid_penalty, 0) > 0
          or coalesce(old.unpaid_other, 0) > 0) then
    raise exception 'ยกเลิกการเช่าไม่ได้ — ต้องปิดยอดค้างชำระก่อน';
  end if;

  if old.status = 'unpaid' and new.status = 'active'
     and (coalesce(new.unpaid_penalty, 0) > 0
          or coalesce(new.unpaid_other, 0) > 0) then
    raise exception 'ปิดสถานะค้างชำระไม่ได้ — ยอดค้างยังไม่เป็นศูนย์';
  end if;

  return new;
end;
$$;

drop trigger if exists vendors_guard_unpaid_state on public.vendors;
create trigger vendors_guard_unpaid_state
before update of status, unpaid_penalty, unpaid_other on public.vendors
for each row execute function public.guard_vendor_unpaid_state();
