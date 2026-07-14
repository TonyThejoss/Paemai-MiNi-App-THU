// ═══════════════════════════════════════════════════════════════
// แพไม้มินิ วันพฤหัสบดี — ค่าคงที่โครงสร้างโซน/ล็อคกลาง (Shared Config)
// เพิ่มใหม่ 14 ก.ค. 2569 (แก้ B-15 บางส่วน)
//
// ไฟล์นี้ต้องถูกโหลดผ่าน <script src="pamai_thu_config.js"></script>
// ก่อน <script> หลักของหน้าเว็บเสมอ
//
// ขอบเขต: ไฟล์นี้รวมเฉพาะ 2 ไฟล์ที่มีข้อมูล ZONE_TOTALS/ZONE_GROUPS
// แบบเดียวกันทุกตัวอักษร (pamai_thu_app.html, pamai_thu_report_01.html)
// ส่วนอีก 4 ไฟล์ (pamai_thu_market_map.html, pamai_thu_installment.html,
// pamai_thu_vendor_registration.html, pamai_thu_report_03.html) ยังคง
// ใช้ค่าคงที่แบบเดิมของตัวเอง (โครงสร้างข้อมูลต่างกัน — market_map.html/
// installment.html ผูกกับพิกัดกริดการแสดงผลจริง (r/c) การรวมเข้าด้วยกัน
// เสี่ยงทำให้ผังตลาดแสดงผลผิดตำแหน่ง จึงจงใจแยกออกจากรอบนี้)
// ═══════════════════════════════════════════════════════════════

const ZONE_TOTALS = {
  'A':20,'B':20,'C':21,'D':22,'E':11,'F':16,
  'G':28,'J':4,'K':12,'N':8,'U':5,
  'O':13,'M':12,'H':12,'L':28,'T':2,'AB':3,
  'TA':20,'TB':20,'TC':20
};
const ZONE_GROUPS = {
  'โซนด้านนอก': ['A','B','C','D','E','F'],
  'ข้าง 7-Eleven': ['G','J','K','N','U'],
  'ข้างโลตัส': ['O','M','H','L','T','AB'],
  'เปิดท้าย': ['TA','TB','TC'],
};
const TOTAL_LOCKS = Object.values(ZONE_TOTALS).reduce((a,b)=>a+b,0);
