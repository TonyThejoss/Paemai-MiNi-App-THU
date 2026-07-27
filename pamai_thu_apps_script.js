// ═══════════════════════════════════════════════════════════════
// แพไม้มินิ — Google Apps Script (Backend API)
// วางโค้ดนี้ใน Google Apps Script แล้ว Deploy as Web App
// ═══════════════════════════════════════════════════════════════

const SHEET_ID = '1o-pBCouIVr2d8UEI33rVXOZf1Ij3b2JxcjrbgBmpMN8'; // Paemai Market Database (Thursday) — โฟลเดอร์ TUE V4

// ── Sheet names ──
const S = {
  VENDORS:  'vendors',
  LEAVE:    'leave_log',
  DAILY:    'daily_bookings',
  PAYMENTS: 'payments',
  ACTIVITY: 'activity_log',
  USERS:    'users',
  INSTALL:  'installment_plans',
  QUEUE:    'floating_queue',  // เพิ่ม 2026-07-21: คิวจองล็อคจร
  RULES:    'market_rules',    // เพิ่ม 2026-07-21: กฎระเบียบตลาด (แก้ไขได้)
  DISCOUNT: 'rent_discounts',  // เพิ่ม 2026-07-26: ส่วนลดค่าเช่ารายเดือน (รายล็อค/ทั้งตลาด)
  SETTINGS: 'settings',        // เพิ่ม 2026-07-26: ค่าตั้งค่ากลางของตลาด (เช่น อัตราค่าธรรมเนียมรายปี)
};

// ════════════════════════════════════════
// DATE NORMALIZATION (เพิ่ม 2026-07-26 — แก้บั๊ก #28 "รายงานดูข้อมูลไม่ได้")
// ต้นเหตุ: แต่ละโมดูลบันทึกคอลัมน์ date ในรูปแบบต่างกัน — ส่วนใหญ่เป็นข้อความไทย ("26 ก.ค. 2569")
// แต่ pamai_thu_installment.html บันทึกเป็น ISO ("2026-07-26") ซึ่ง Google Sheets แปลงเป็น Date object
// อัตโนมัติ ทำให้การกรองแบบ r.date === date (เทียบสตริงตรง ๆ) หาไม่เจอและรายงานว่างเปล่า
// ทางแก้: normalize ทุกค่าให้เป็น 'YYYY-MM-DD' ก่อนเทียบเสมอ ทั้งฝั่งข้อมูลในชีตและฝั่งพารามิเตอร์
// ที่หน้าเว็บส่งมา — จึงยัง backward compatible กับหน้าเว็บเดิมที่ส่งวันที่แบบไทยมาทุกไฟล์
// ════════════════════════════════════════
const _MONS_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const _MONS_TH_FULL = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                       'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
function _pad2(n) { return ('0' + n).slice(-2); }
function _normDate(v) {
  if (v === null || v === undefined || v === '') return '';
  let s;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    s = Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd');
  } else {
    s = String(v).trim();
  }
  // ── ปีพุทธศักราชในรูปแบบ ISO/Date (สำคัญมาก — ตรวจพบจากข้อมูลจริงในชีต 2026-07-27) ──
  // สเปรดชีตตั้งค่า locale เป็นไทย Google Sheets จึง "แปลง" ข้อความวันที่ไทยที่เราเขียนลงไป
  // (เช่น "6 ก.ค. 2569") ให้กลายเป็นค่าวันที่จริงโดยตีความ 2569 เป็นปี ค.ศ. ตรง ๆ
  // เวลาอ่านกลับผ่าน JSON จึงได้ "2569-07-06T07:00:00.000Z" ไม่ใช่ข้อความไทยอย่างที่โค้ดเดิมคาดไว้
  // → ทุกค่าที่ปี > 2400 ต้องลบ 543 ก่อนเสมอ ไม่งั้นเทียบวันที่ไม่ตรงตลอดกาล และรายงานจะว่างเปล่า
  //   (นี่คือสาเหตุที่แท้จริงของอาการ "รายงานดูข้อมูลไม่ได้" — ลึกกว่าที่วิเคราะห์ไว้ตอนแรกหนึ่งชั้น)
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);            // ISO (อาจเป็นปี พ.ศ.)
  if (m) {
    let y = parseInt(m[1], 10);
    if (y > 2400) y -= 543;
    return y + '-' + _pad2(parseInt(m[2], 10)) + '-' + _pad2(parseInt(m[3], 10));
  }
  m = s.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})$/);                // ไทยย่อ/เต็ม: 26 ก.ค. 2569
  if (m) {
    let mi = _MONS_TH.indexOf(m[2]);
    if (mi < 0) mi = _MONS_TH_FULL.indexOf(m[2]);
    if (mi >= 0) {
      let y = parseInt(m[3], 10); if (y > 2400) y -= 543;
      return y + '-' + _pad2(mi + 1) + '-' + _pad2(parseInt(m[1], 10));
    }
  }
  m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);        // 26/7/2569
  if (m) {
    let y = parseInt(m[3], 10); if (y > 2400) y -= 543;
    return y + '-' + _pad2(parseInt(m[2], 10)) + '-' + _pad2(parseInt(m[1], 10));
  }
  return s;
}
// กรองแถวตามเกณฑ์วันที่ที่หน้าเว็บส่งมา — รองรับ 4 โหมด: วันเดียว / ช่วงวันที่ / เดือน (YYYY-MM) / ทั้งหมด
// ถ้าไม่ส่งเกณฑ์ใดเลยจะคืน true ทุกแถว (ผู้เรียกเป็นคนตัดสินว่าจะกรองหรือไม่)
function _matchDate(rowDate, opt) {
  const d = _normDate(rowDate);
  if (!opt) return true;
  if (opt.date)  return d === _normDate(opt.date);
  if (opt.month) return d.slice(0, 7) === String(opt.month).slice(0, 7);
  if (opt.from && d < _normDate(opt.from)) return false;
  if (opt.to   && d > _normDate(opt.to))   return false;
  return true;
}
function _dateOpt(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  const o = {};
  if (p.date)  o.date  = p.date;
  if (p.month) o.month = p.month;
  if (p.from)  o.from  = p.from;
  if (p.to)    o.to    = p.to;
  return (o.date || o.month || o.from || o.to) ? o : null;
}
function _todayISO() { return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'); }
function _thisMonthISO() { return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM'); }

// ════════════════════════════════════════
// PHONE NUMBER (เพิ่ม 2026-07-26 — แก้บั๊ก #29 "เลข 0 หน้าเบอร์โทรหายหลังกดบันทึก")
// ต้นเหตุ: Google Sheets แปลงสตริง "0812345678" เป็น "ตัวเลข" อัตโนมัติ เลข 0 นำหน้าจึงถูกตัดทิ้ง
// เมื่ออ่านกลับมาได้ 812345678 — ไม่ใช่บั๊กของหน้าเว็บ (ช่องกรอกเป็น type=tel เก็บสตริงถูกต้องแล้ว)
// ทางแก้ 2 ชั้น: (1) บังคับ number format ของคอลัมน์เบอร์โทรเป็นข้อความ '@' ก่อนเขียนทุกครั้ง
// (2) _normPhone() เติม 0 คืนตอนอ่าน เพื่อกู้ข้อมูลเก่าที่เสียไปแล้วในชีตโดยไม่ต้องแก้มือ
// ════════════════════════════════════════
function _normPhone(v) {
  if (v === null || v === undefined || v === '') return '';
  let s = String(v).trim();
  if (s === '—' || s === '-') return s;
  if (/^\d+$/.test(s)) {
    if (s.length === 9)  s = '0' + s;              // เบอร์มือถือ/บ้าน 10 หลักที่ 0 หายไป
    else if (s.length === 8) s = '0' + s;          // เบอร์บ้าน 9 หลักที่ 0 หายไป
  }
  return s;
}
// เพิ่มคอลัมน์ใหม่ให้ชีตที่ใช้งานจริงอยู่แล้วอย่างปลอดภัย (idempotent)
// initSheets() สร้าง header เฉพาะตอนชีตยังว่าง จึงไม่ช่วยกับชีตที่มีข้อมูลจริงแล้ว
function _ensureColumn(sheet, headerName) {
  const lastCol = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf(headerName) >= 0) return headers.indexOf(headerName);
  sheet.getRange(1, lastCol + 1).setValue(headerName);
  return lastCol;   // 0-based index ของคอลัมน์ใหม่
}
function _forceTextCol(sheet, headerName) {
  try {
    const headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
    const idx = headers.indexOf(headerName);
    if (idx < 0) return;
    const rows = Math.max(sheet.getMaxRows() - 1, 1);
    sheet.getRange(2, idx + 1, rows, 1).setNumberFormat('@');
  } catch (err) { /* ไม่ critical — ถ้าตั้ง format ไม่ได้ ยังมี _normPhone() กู้ตอนอ่าน */ }
}

// ── CORS Helper ──
function makeRes(data, status='ok') {
  const payload = JSON.stringify({ status, data, ts: new Date().toISOString() });
  return ContentService
    .createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}

function makeErr(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', message: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ── ACCESS TOKEN (B-13: ตั้งค่าจริงที่ Project Settings > Script Properties > API_TOKEN
// ห้าม hardcode ค่าจริงในไฟล์นี้ — repo เป็น public) ──
function getApiToken() {
  return PropertiesService.getScriptProperties().getProperty('API_TOKEN') || '';
}
function checkToken(providedToken) {
  const real = getApiToken();
  if (!real) return true; // ยังไม่ตั้งค่า = โหมดผ่อนผัน (fail-open)
  return providedToken === real;
}

// ── GET Router ──
// PUBLIC_ACTIONS: action ที่ "เจตนา" ให้เรียกได้โดยไม่ต้องมี token — ใช้กับหน้าสถานะสาธารณะ
// (pamai_thu_public_status.html) ที่เปิดให้ผู้ค้าดูได้โดยไม่ต้อง login/รหัสผ่านใด ๆ
// ห้ามเพิ่ม action อื่นเข้าไลน์นี้โดยไม่ตรวจให้แน่ใจก่อนว่าไม่มีข้อมูลอ่อนไหว (เบอร์โทร/LINE/รหัสผ่าน)
// หลุดออกไปในผลลัพธ์ — ดูรายละเอียดการกรองฟิลด์ใน getPublicStatus()
const PUBLIC_ACTIONS = ['getPublicStatus'];

function doGet(e) {
  try {
    const action = e.parameter.action || '';
    if (!PUBLIC_ACTIONS.includes(action) && !checkToken(e.parameter.token)) {
      return makeErr('Unauthorized: invalid or missing token');
    }
    switch(action) {
      case 'getVendors':    return getVendors();
      case 'getLeaveLog':   return getLeaveLog(_dateOpt(e), e.parameter.lockId, e.parameter.zone);
      case 'getDailyBookings': return getDailyBookings(_dateOpt(e), e.parameter.lockId, e.parameter.zone);
      case 'getPayments':   return getPayments(_dateOpt(e), e.parameter.lockId);
      case 'getUsers':      return getUsers();
      case 'initSheets':    return initSheets();
      case 'migrateHashPasswords': return migrateHashPasswords();
      case 'getInstallmentPlans': return getInstallmentPlans();
      case 'getFloatingQueue': return getFloatingQueue(_dateOpt(e));
      case 'getMarketRules':   return getMarketRules();
      case 'getPublicStatus':  return getPublicStatus(e.parameter.date);
      // เพิ่ม 2026-07-26
      case 'getDiscounts':     return getDiscounts(e.parameter.month);
      case 'getSettings':      return getSettings();
      case 'getActivityLog':   return getActivityLog(_dateOpt(e));
      default: return makeErr('Unknown action: ' + action);
    }
  } catch(err) {
    return makeErr(err.toString());
  }
}

// ── AUTO ACTIVITY LOG (เพิ่ม 2026-07-26 — บั๊ก #30) ──
// ปัญหา: หน้า "บันทึกกิจกรรม" ไม่เห็นกิจกรรมทั้งหมดที่เกิดขึ้นจริง เพราะแต่ละหน้าเว็บต้องเรียก
// logActivity เองและหลายหน้าไม่ได้เรียก (แถมหน้าแดชบอร์ดเก็บ log ไว้ในหน่วยความจำอย่างเดียว)
// ทางแก้เชิงสถาปัตยกรรม: บันทึกที่ "ประตูเดียว" คือ doPost — ทุก action ที่เปลี่ยนข้อมูลจะถูกบันทึก
// อัตโนมัติ ไม่ว่าหน้าไหนเรียกมา จึงครบถ้วนโดยไม่ต้องแก้ทุกไฟล์ frontend และไม่พลาดในอนาคต
const AUTO_LOG_LABELS = {
  saveVendor:              'บันทึก/แก้ไขข้อมูลผู้ค้าประจำ',
  deleteVendor:            'ลบข้อมูลผู้ค้าประจำ',
  logLeave:                'บันทึกสถานะแจ้งลา/ขาดล็อค',
  saveDailyBooking:        'บันทึกผู้ค้าจร',
  cancelDailyBooking:      'ยกเลิกผู้ค้าจร',
  savePayment:             'รับชำระเงิน',
  changePassword:          'เปลี่ยนรหัสผ่าน',
  saveInstallmentPlan:     'ตั้ง/แก้ไขแผนผ่อนชำระ',
  deleteInstallmentPlan:   'ลบแผนผ่อนชำระ',
  saveFloatingQueueEntry:  'เพิ่มคิวจองล็อคจร',
  sellFloatingQueueEntry:  'ขายล็อคจร',
  editFloatingQueueEntry:  'แก้ไขรายการล็อคจร',
  cancelFloatingQueueEntry:'ยกเลิกคิว/ล็อคจร',
  saveMarketRules:         'แก้ไขกฎระเบียบตลาด',
  saveDiscount:            'กำหนดส่วนลดค่าเช่า',
  deleteDiscount:          'ลบส่วนลดค่าเช่า',
  saveSettings:            'แก้ไขค่าตั้งค่าของตลาด',
  clearLeaveForDate:       'ปลดสถานะลา/ขาดล็อค',
};
// action ที่ "ไม่" ต้องบันทึก: logActivity (จะซ้อนกันเอง) และ verifyUser (ล็อกอินมีบ่อยมาก)
const AUTO_LOG_SKIP = ['logActivity', 'verifyUser', 'purgeOldActivity'];

function _autoLog(action, body, resText) {
  if (AUTO_LOG_SKIP.indexOf(action) >= 0) return;
  const label = AUTO_LOG_LABELS[action];
  if (!label) return;
  try {
    // เขียนตรงลงชีต (ไม่เรียก logActivity เพื่อไม่ให้ purge ทำงานซ้ำซ้อนหลายรอบใน request เดียว)
    const d = body.data || {};
    const who = d.manager || d.created_by || d.updatedBy || body.updatedBy || d.sold_by || d.user || 'ผู้ใช้ระบบ';
    const lock = d.lock || d.lock_id || body.lockId || d.assigned_lock || body.id || '';
    let detail = lock ? ('ล็อค ' + lock) : '';
    if (d.amount !== undefined && d.amount !== '') detail += (detail ? ' · ' : '') + 'ยอด ฿' + d.amount;
    if (d.type && action === 'savePayment') detail += (detail ? ' · ' : '') + String(d.type);
    if (d.type && action === 'logLeave') detail += (detail ? ' · ' : '') + String(d.type);
    if (action === 'saveDiscount') {
      detail += (detail ? ' · ' : '') + (d.scope === 'market' ? 'ทั้งตลาด' : 'รายล็อค') +
                ' เดือน ' + (d.month || '') + ' ฿' + (d.amount || 0);
    }
    const sheet = getSheet(S.ACTIVITY);
    sheet.appendRow(['AC' + Date.now(), who, _autoLogType(action), label, detail,
                     _todayISO(), Utilities.formatDate(new Date(), 'Asia/Bangkok', 'HH:mm')]);
    if (Math.random() < 0.05) { try { _purgeActivity(ACTIVITY_RETENTION_DAYS); } catch (err2) {} }
  } catch (err) { /* บันทึกกิจกรรมล้มเหลวต้องไม่ทำให้การบันทึกข้อมูลหลักล้มเหลว */ }
}
function _autoLogType(action) {
  if (action.indexOf('Payment') >= 0) return 'payment';
  if (action.indexOf('Vendor') >= 0) return 'vendor';
  if (action.indexOf('Leave') >= 0 || action === 'logLeave') return 'leave';
  if (action.indexOf('Daily') >= 0 || action.indexOf('FloatingQueue') >= 0) return 'daily';
  if (action.indexOf('Installment') >= 0) return 'installment';
  if (action.indexOf('Discount') >= 0) return 'discount';
  return 'system';
}

// ── POST Router ──
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    if (!checkToken(body.token)) return makeErr('Unauthorized: invalid or missing token');
    const action = body.action || '';
    const _res = _routePost(action, body);
    // บันทึกกิจกรรมอัตโนมัติเฉพาะเมื่อ action ทำงานสำเร็จ (ผลลัพธ์ status:'ok')
    try {
      const txt = _res && _res.getContent ? _res.getContent() : '';
      if (txt.indexOf('"status":"ok"') >= 0) _autoLog(action, body, txt);
    } catch (err) {}
    return _res;
  } catch(err) {
    return makeErr(err.toString());
  }
}

function _routePost(action, body) {
  try {
    switch(action) {
      case 'saveVendor':       return saveVendor(body.data);
      case 'deleteVendor':     return deleteVendor(body.lockId);
      case 'logLeave':         return logLeave(body.data);
      case 'saveDailyBooking': return saveDailyBooking(body.data);
      case 'cancelDailyBooking': return cancelDailyBooking(body.lockId, body.date);
      case 'savePayment':      return savePayment(body.data);
      case 'logActivity':      return logActivity(body.data);
      case 'changePassword':   return changePassword(body.username, body.oldPw, body.newPw);
      case 'verifyUser':       return verifyUser(body.username, body.password);
      case 'saveInstallmentPlan':   return saveInstallmentPlan(body.data);
      case 'deleteInstallmentPlan': return deleteInstallmentPlan(body.lockId);
      case 'saveFloatingQueueEntry':   return saveFloatingQueueEntry(body.data);
      case 'sellFloatingQueueEntry':   return sellFloatingQueueEntry(body.data);
      case 'editFloatingQueueEntry':   return editFloatingQueueEntry(body.id, body.data);
      case 'cancelFloatingQueueEntry': return cancelFloatingQueueEntry(body.id, body.reason);
      case 'saveMarketRules':          return saveMarketRules(body.content, body.updatedBy);
      // เพิ่ม 2026-07-26
      case 'saveDiscount':     return saveDiscount(body.data);
      case 'deleteDiscount':   return deleteDiscount(body.id);
      case 'saveSettings':     return saveSettings(body.data, body.updatedBy);
      case 'clearLeaveForDate': return clearLeaveForDate(body.lockId, body.date);
      case 'purgeOldActivity': return purgeOldActivity(body.days);
      default: return makeErr('Unknown action: ' + action);
    }
  } catch(err) {
    return makeErr(err.toString());
  }
}

// ════════════════════════════════════════
// HELPER — Get or create sheet
// ════════════════════════════════════════
function getSheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

// ════════════════════════════════════════
// INIT — สร้าง headers ทุก sheet
// ════════════════════════════════════════
function initSheets() {
  // vendors
  const vSheet = getSheet(S.VENDORS);
  if (vSheet.getLastRow() === 0) {
    vSheet.appendRow(['lock','zone','name','phone','line','product','type',
                      'dailyRate','elec_bulb','elec_fan','elec_small','elec_large',
                      'elec_special','status','unpaid_penalty','unpaid_other','unpaid_other_label',
                      'created_at','updated_at']);
  }
  // leave_log
  const lSheet = getSheet(S.LEAVE);
  if (lSheet.getLastRow() === 0) {
    lSheet.appendRow(['id','lock_id','zone','shop','type','note','manager','date','time','created_at']);
  }
  // daily_bookings
  const dSheet = getSheet(S.DAILY);
  if (dSheet.getLastRow() === 0) {
    dSheet.appendRow(['id','lock_id','zone','vendor_name','phone','product',
                      'price','elec','total','method','date','time',
                      'original_status','cancelled','created_at']);
  }
  // payments
  const pSheet = getSheet(S.PAYMENTS);
  if (pSheet.getLastRow() === 0) {
    pSheet.appendRow(['id','lock_id','vendor_name','product','type','amount',
                      'penalty','other_fee','other_label','method','note','date','time']);
  }
  // activity_log
  const aSheet = getSheet(S.ACTIVITY);
  if (aSheet.getLastRow() === 0) {
    aSheet.appendRow(['id','user','type','message','detail','date','time']);
  }
  // users
  // หมายเหตุความปลอดภัย (2026-07-14): คอลัมน์ 'password' เก็บเป็น SHA-256 hash (+ 'salt' แยกคอลัมน์)
  // ไม่ใช่ plain text อีกต่อไป — ดู hashPassword()/generateSalt() ด้านล่าง และ migrateHashPasswords()
  // สำหรับชีตเก่าที่เคยสร้างด้วยรหัสผ่านแบบ plain text
  const uSheet = getSheet(S.USERS);
  if (uSheet.getLastRow() === 0) {
    uSheet.appendRow(['username','password','salt','role','display_name','role_label','created_at']);
    // Insert default users (รหัสผ่านเริ่มต้น — ควรให้ผู้ใช้เปลี่ยนทันทีหลัง deploy ครั้งแรก)
    const now = new Date().toISOString();
    const seed = [
      ['tony2568','pm246810','admin','โทนี่','ผู้ดูแลระบบ'],
      ['fon12345','fn135790','admin','คุณฝน','ผู้จัดการ'],
      ['too56789','tu975310','admin','คุณตู่','ผู้จัดการ'],
      ['aew98765','ae864209','viewer','คุณแอ๋ว','ผู้ดูแลโซนนอก (ดูอย่างเดียว)'],
    ];
    seed.forEach(function(u) {
      const salt = generateSalt();
      uSheet.appendRow([u[0], hashPassword(u[1], salt), salt, u[2], u[3], u[4], now]);
    });
  }
  // installment_plans (เพิ่ม 2026-07-14 — แก้บั๊ก #19: โมดูลผ่อนชำระเดิมใช้ข้อมูลจำลองทั้งหมด)
  // ยอดหนี้จริงคำนวณจาก vendors.unpaid_penalty + vendors.unpaid_other (ไม่ซ้ำเก็บที่นี่)
  // เก็บเฉพาะ "แผนผ่อน" ที่ตั้งไว้ ส่วนเงินที่รับจริงบันทึกที่ชีต payments (type='installment') ตามเดิม
  const iSheet = getSheet(S.INSTALL);
  if (iSheet.getLastRow() === 0) {
    iSheet.appendRow(['lock_id','terms','first_amount','start_date','deadline','status','created_at','updated_at']);
  }
  // floating_queue (เพิ่ม 2026-07-21: ระบบจองล็อคจรแบบคิว)
  // สถานะ: waiting (รอคิว) / sold (ขายแล้ว — ผูกกับ daily_bookings ด้วย) / cancelled (ยกเลิก)
  const qSheet = getSheet(S.QUEUE);
  if (qSheet.getLastRow() === 0) {
    qSheet.appendRow(['id','market_date','vendor_name','phone','line','zone_pref','note',
                      'requested_at','status','assigned_lock','price','elec','total','method',
                      'sold_by','sold_at','cancel_reason','updated_at']);
  }
  // market_rules (เพิ่ม 2026-07-21: กฎระเบียบตลาดที่แก้ไขได้ — เก็บเป็นแถวเดียว/ตลาด)
  const rSheet = getSheet(S.RULES);
  if (rSheet.getLastRow() === 0) {
    rSheet.appendRow(['content','updated_by','updated_at']);
  }
  // rent_discounts (เพิ่ม 2026-07-26: ส่วนลดค่าเช่ารายเดือน — รายล็อค/ทั้งตลาด หน่วยบาท)
  const dcSheet = getSheet(S.DISCOUNT);
  if (dcSheet.getLastRow() === 0) {
    dcSheet.appendRow(['id','month','scope','lock_id','amount','apply_installment','note','status',
                       'created_by','created_at','updated_at']);
  }
  // settings (เพิ่ม 2026-07-26: ค่าตั้งค่ากลาง เช่น อัตราค่าธรรมเนียมรายปี)
  const stSheet = getSheet(S.SETTINGS);
  if (stSheet.getLastRow() === 0) {
    stSheet.appendRow(['key','value','updated_by','updated_at']);
  }
  // บังคับคอลัมน์เบอร์โทรเป็นข้อความ กันเลข 0 นำหน้าหาย (บั๊ก #29)
  _forceTextCol(vSheet, 'phone');
  _forceTextCol(dSheet, 'phone');
  _forceTextCol(qSheet, 'phone');
  return makeRes('Sheets initialized');
}

// ════════════════════════════════════════
// VENDORS CRUD
// ════════════════════════════════════════
function getVendors() {
  const sheet = getSheet(S.VENDORS);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return makeRes([]);
  const headers = rows[0];
  const vendors = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    // Parse elec_special from JSON string
    try { obj.elec_special = JSON.parse(obj.elec_special || '[]'); } catch(e) { obj.elec_special = []; }
    obj.phone = _normPhone(obj.phone);  // กู้เลข 0 นำหน้าที่ Sheets ตัดทิ้ง (บั๊ก #29)
    return obj;
  });
  return makeRes(vendors);
}

function saveVendor(data) {
  const sheet   = getSheet(S.VENDORS);
  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const now     = new Date().toISOString();

  // หา row เดิมถ้ามี (merge แบบ partial update เพื่อไม่ให้ฟิลด์อื่นหาย
  // เช่นตอน batch_payment ส่งมาแค่ {lock, status} ไม่ควรลบ name/phone/dailyRate เดิม)
  const lockIdx = headers.indexOf('lock');
  let foundRow = -1;
  let existing = {};
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][lockIdx] === data.lock) {
      foundRow = i + 1;
      headers.forEach((h, idx) => existing[h] = rows[i][idx]);
      break;
    }
  }

  const merged = {
    lock: data.lock,
    zone: data.zone !== undefined ? data.zone : (existing.zone || ''),
    name: data.name !== undefined ? data.name : (existing.name || ''),
    phone: _normPhone(data.phone !== undefined ? data.phone : (existing.phone || '')),
    line: data.line !== undefined ? data.line : (existing.line || ''),
    product: data.product !== undefined ? data.product : (existing.product || ''),
    type: data.type !== undefined ? data.type : (existing.type || 'regular'),
    dailyRate: data.dailyRate !== undefined ? data.dailyRate : (existing.dailyRate || 0),
    elec_bulb: data.elec_bulb !== undefined ? data.elec_bulb : (existing.elec_bulb || 0),
    elec_fan: data.elec_fan !== undefined ? data.elec_fan : (existing.elec_fan || 0),
    elec_small: data.elec_small !== undefined ? data.elec_small : (existing.elec_small || 0),
    elec_large: data.elec_large !== undefined ? data.elec_large : (existing.elec_large || 0),
    elec_special: JSON.stringify(data.elec_special !== undefined ? data.elec_special : (existing.elec_special ? (typeof existing.elec_special === 'string' ? JSON.parse(existing.elec_special || '[]') : existing.elec_special) : [])),
    status: data.status !== undefined ? data.status : (existing.status || 'active'),
    unpaid_penalty: data.unpaid_penalty !== undefined ? data.unpaid_penalty : (existing.unpaid_penalty || 0),
    unpaid_other: data.unpaid_other !== undefined ? data.unpaid_other : (existing.unpaid_other || 0),
    unpaid_other_label: data.unpaid_other_label !== undefined ? data.unpaid_other_label : (existing.unpaid_other_label || ''),
    created_at: existing.created_at || now,
    updated_at: now,
  };

  const rowData = headers.map(h => merged[h] !== undefined ? merged[h] : '');

  _forceTextCol(sheet, 'phone');   // บั๊ก #29: กันเลข 0 นำหน้าเบอร์โทรหาย
  if (foundRow > 0) {
    sheet.getRange(foundRow, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }
  return makeRes({ action: foundRow > 0 ? 'updated' : 'created', lock: data.lock });
}

function deleteVendor(lockId) {
  const sheet = getSheet(S.VENDORS);
  const rows  = sheet.getDataRange().getValues();
  const lockIdx = rows[0].indexOf('lock');
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][lockIdx] === lockId) {
      sheet.deleteRow(i + 1);
      return makeRes({ deleted: lockId });
    }
  }
  return makeErr('Lock not found: ' + lockId);
}

// ════════════════════════════════════════
// LEAVE LOG
// ════════════════════════════════════════
function getLeaveLog(opt, lockId, zone) {
  const sheet = getSheet(S.LEAVE);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return makeRes([]);
  const headers = rows[0];
  let data = rows.slice(1).map(row => {
    const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]);
    obj.date_iso = _normDate(obj.date);           // ให้หน้าเว็บเรียง/กรองต่อได้โดยไม่ต้องแปลงเอง
    return obj;
  });
  if (opt)    data = data.filter(r => _matchDate(r.date, opt));
  if (lockId) data = data.filter(r => r.lock_id === lockId);
  if (zone)   data = data.filter(r => r.zone === zone);
  return makeRes(data);
}

// ── ตรรกะประวัติการลา/ขาด (ปรับ 2026-07-26 ตามข้อกำหนดใหม่) ──
// กติกา: 1 ล็อค + 1 วัน = ประวัติได้แค่ 1 รายการเท่านั้น
//  · แจ้งลา/ขาดซ้ำในวันเดิม → เขียนทับแถวเดิม (ไม่เพิ่มแถวใหม่ ไม่ให้ประวัติซ้ำซ้อน)
//  · ปลดสถานะ (cancel) → ลบแถวของวันนั้นออกจากประวัติจริง ไม่ใช่เพิ่มแถว 'cancel' ทับ
//    เพื่อให้ "ประวัติการแจ้งลาในวันนั้นหายไปด้วย" ตามที่ผู้ดูแลตลาดกำหนด
//  · แจ้งใหม่วันเดิมหลังปลด → ได้แถวใหม่ 1 แถวตามปกติ (ประวัติกลับมาปรากฏ)
// ประเภทที่ถือว่าเป็นการปลดสถานะ: cancel / leave_cancel / absent_cancel (สองตัวหลังมาจากแอพวันพฤหัสฯ เดิม)
const _CANCEL_TYPES = ['cancel', 'leave_cancel', 'absent_cancel'];
function logLeave(data) {
  const sheet   = getSheet(S.LEAVE);
  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const iLock = headers.indexOf('lock_id'), iDate = headers.indexOf('date'), iType = headers.indexOf('type');
  const targetDate = _normDate(data.date);
  const isCancel   = _CANCEL_TYPES.indexOf(String(data.type)) >= 0;

  // ยกเลิกสัญญาเช่า (lease_cancel) เป็นเหตุการณ์ถาวร ไม่ใช่สถานะรายวัน → เก็บเป็นประวัติแยกตามปกติ
  if (String(data.type) === 'lease_cancel') {
    const id0 = 'LV' + Date.now();
    sheet.appendRow([id0, data.lock_id, data.zone, data.shop, data.type,
                     data.note||'', data.manager||'', data.date, data.time, new Date().toISOString()]);
    return makeRes({ id: id0 });
  }

  // หาแถว "สถานะรายวัน" เดิมของล็อคนี้ในวันเดียวกัน (leave/absent เท่านั้น)
  let foundRow = -1;
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][iLock] !== data.lock_id) continue;
    if (_normDate(rows[i][iDate]) !== targetDate) continue;
    const t = String(rows[i][iType]);
    if (t === 'leave' || t === 'absent') { foundRow = i + 1; break; }
  }

  if (isCancel) {
    if (foundRow > 0) { sheet.deleteRow(foundRow); return makeRes({ cleared: true, lock: data.lock_id, date: targetDate }); }
    return makeRes({ cleared: false, note: 'ไม่พบประวัติของวันนั้น (อาจถูกลบไปแล้ว)' });
  }

  const now = new Date().toISOString();
  if (foundRow > 0) {
    // เขียนทับแถวเดิม — คง id เดิมไว้เพื่อไม่ให้ประวัติ/รายงานอ้างอิงเสีย
    const keepId = rows[foundRow - 1][headers.indexOf('id')] || ('LV' + Date.now());
    const rowData = [keepId, data.lock_id, data.zone, data.shop, data.type,
                     data.note||'', data.manager||'', data.date, data.time, now];
    sheet.getRange(foundRow, 1, 1, rowData.length).setValues([rowData]);
    return makeRes({ id: keepId, replaced: true });
  }
  const id = 'LV' + Date.now();
  sheet.appendRow([id, data.lock_id, data.zone, data.shop, data.type,
                   data.note||'', data.manager||'', data.date, data.time, now]);
  return makeRes({ id });
}

// ลบประวัติสถานะรายวัน (ลา/ขาด) ของล็อคหนึ่งในวันหนึ่งออกทั้งหมด — ใช้เมื่อผู้ดูแลกดปลดสถานะ
function clearLeaveForDate(lockId, date) {
  if (!lockId || !date) return makeErr('ต้องระบุ lockId และ date');
  const sheet   = getSheet(S.LEAVE);
  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const iLock = headers.indexOf('lock_id'), iDate = headers.indexOf('date'), iType = headers.indexOf('type');
  const target = _normDate(date);
  let removed = 0;
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][iLock] !== lockId) continue;
    if (_normDate(rows[i][iDate]) !== target) continue;
    const t = String(rows[i][iType]);
    if (t !== 'leave' && t !== 'absent') continue;
    sheet.deleteRow(i + 1); removed++;
  }
  return makeRes({ removed: removed, lock: lockId, date: target });
}

// ════════════════════════════════════════
// DAILY BOOKINGS (ผู้ค้าจร)
// ════════════════════════════════════════
function getDailyBookings(opt, lockId, zone) {
  const sheet = getSheet(S.DAILY);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return makeRes([]);
  const headers = rows[0];
  let data = rows.slice(1).map(row => {
    const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]);
    obj.phone = _normPhone(obj.phone);
    obj.date_iso = _normDate(obj.date);
    return obj;
  }).filter(r => r.cancelled !== true && r.cancelled !== 'TRUE');
  if (opt)    data = data.filter(r => _matchDate(r.date, opt));
  if (lockId) data = data.filter(r => r.lock_id === lockId);
  if (zone)   data = data.filter(r => r.zone === zone);
  return makeRes(data);
}

function saveDailyBooking(data) {
  const sheet = getSheet(S.DAILY);
  const id    = 'DV' + Date.now();
  const now   = new Date().toISOString();
  _forceTextCol(sheet, 'phone');
  sheet.appendRow([id, data.lock_id, data.zone, data.vendor_name, _normPhone(data.phone),
                   data.product, data.price, data.elec||0, data.total,
                   data.method, data.date, data.time, data.original_status||'', false, now]);
  return makeRes({ id });
}

function cancelDailyBooking(lockId, date) {
  const sheet   = getSheet(S.DAILY);
  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const lockIdx = headers.indexOf('lock_id');
  const dateIdx = headers.indexOf('date');
  const canIdx  = headers.indexOf('cancelled');
  // เทียบวันที่แบบ normalize (แก้ 2026-07-27): ค่าในชีตเป็น Date ปี พ.ศ. ไม่ใช่ข้อความไทยอย่างที่โค้ดเดิมคิด
  // การเทียบสตริงตรง ๆ จึงไม่เคยเจอแถว ทำให้ "ยกเลิกผู้ค้าจร" ไม่มีผลจริงในฐานข้อมูล
  const target = _normDate(date);
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][lockIdx] === lockId && _normDate(rows[i][dateIdx]) === target && rows[i][canIdx] !== true) {
      sheet.getRange(i+1, canIdx+1).setValue(true);
      return makeRes({ cancelled: lockId });
    }
  }
  return makeErr('Booking not found');
}

// ════════════════════════════════════════
// PAYMENTS
// ════════════════════════════════════════
function getPayments(opt, lockId) {
  const sheet = getSheet(S.PAYMENTS);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return makeRes([]);
  const headers = rows[0];
  let data = rows.slice(1).map(row => {
    const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]);
    obj.date_iso = _normDate(obj.date);
    return obj;
  });
  if (opt)    data = data.filter(r => _matchDate(r.date, opt));
  if (lockId) data = data.filter(r => r.lock_id === lockId);
  return makeRes(data);
}

function savePayment(data) {
  const sheet = getSheet(S.PAYMENTS);
  const id    = 'PY' + Date.now();
  sheet.appendRow([id, data.lock_id, data.vendor_name||'', data.product||'',
                   data.type, data.amount, data.penalty||0, data.other_fee||0,
                   data.other_label||'', data.method, data.note||'', data.date, data.time]);
  return makeRes({ id });
}

// ════════════════════════════════════════
// ACTIVITY LOG
// ════════════════════════════════════════
// ปรับ 2026-07-26 (บั๊ก #30): บันทึกกิจกรรมลงชีตจริงทุกครั้ง + ลบอัตโนมัติเมื่อเกิน 30 วัน
// เดิมหน้าแดชบอร์ดเก็บ activity log ไว้ในตัวแปร ACT_LOG ในหน่วยความจำเท่านั้น (หายทุกครั้งที่รีเฟรช
// และไม่เห็นกิจกรรมของผู้จัดคนอื่น) จึงเปลี่ยนเป็นอ่าน/เขียนชีต activity_log เป็นแหล่งจริงแหล่งเดียว
const ACTIVITY_RETENTION_DAYS = 30;
function logActivity(data) {
  const sheet = getSheet(S.ACTIVITY);
  const id    = 'AC' + Date.now();
  sheet.appendRow([id, data.user||'system', data.type, data.message, data.detail||'',
                   data.date || _todayISO(), data.time || Utilities.formatDate(new Date(),'Asia/Bangkok','HH:mm')]);
  // ล้างอัตโนมัติแบบสุ่มเบา ๆ (≈1 ใน 12 ครั้งที่เขียน) เพื่อไม่ให้ทุก request ต้องสแกนทั้งชีต
  if (Math.random() < 0.08) { try { _purgeActivity(ACTIVITY_RETENTION_DAYS); } catch (err) {} }
  return makeRes({ id });
}

function getActivityLog(opt) {
  _purgeActivity(ACTIVITY_RETENTION_DAYS);   // ทุกครั้งที่หน้าเว็บเปิดดู ให้ลบของเก่าเกินกำหนดก่อน
  const sheet = getSheet(S.ACTIVITY);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return makeRes([]);
  const headers = rows[0];
  let data = rows.slice(1).map(row => {
    const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]);
    obj.date_iso = _normDate(obj.date);
    return obj;
  });
  if (opt) data = data.filter(r => _matchDate(r.date, opt));
  data.sort((a,b) => String(b.id).localeCompare(String(a.id)));   // ใหม่สุดขึ้นก่อน
  return makeRes(data);
}

function _purgeActivity(days) {
  const sheet = getSheet(S.ACTIVITY);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return 0;
  const iDate = rows[0].indexOf('date');
  const iId   = rows[0].indexOf('id');
  const cutoffMs = Date.now() - (days * 86400000);
  const cutoffISO = Utilities.formatDate(new Date(cutoffMs), 'Asia/Bangkok', 'yyyy-MM-dd');
  let removed = 0;
  for (let i = rows.length - 1; i >= 1; i--) {
    let d = _normDate(rows[i][iDate]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      // ไม่มีวันที่อ่านได้ → ใช้ timestamp ที่ฝังใน id ('AC<ms>') เป็นตัวตัดสินแทน
      const m = String(rows[i][iId]).match(/^AC(\d{10,})$/);
      if (!m) continue;
      if (parseInt(m[1], 10) >= cutoffMs) continue;
    } else if (d >= cutoffISO) continue;
    sheet.deleteRow(i + 1); removed++;
  }
  return removed;
}
function purgeOldActivity(days) {
  const n = _purgeActivity(parseInt(days, 10) > 0 ? parseInt(days, 10) : ACTIVITY_RETENTION_DAYS);
  return makeRes({ removed: n });
}

// ════════════════════════════════════════
// SETTINGS — ค่าตั้งค่ากลางของตลาด (เพิ่ม 2026-07-26)
// เก็บเป็น key/value เพื่อให้เพิ่มค่าใหม่ในอนาคตได้โดยไม่ต้องแก้ schema
// คีย์ที่ระบบใช้ตอนนี้: annual_fee (อัตราค่าธรรมเนียมรายปีกลางทั้งตลาด), entry_fee (ค่าแรกเข้าเริ่มต้น)
// ════════════════════════════════════════
const DEFAULT_SETTINGS = { annual_fee: 0, entry_fee: 0 };
function getSettings() {
  const rows = _sheetToObjects(S.SETTINGS);
  const out = {};
  Object.keys(DEFAULT_SETTINGS).forEach(k => out[k] = DEFAULT_SETTINGS[k]);
  rows.forEach(r => { if (r.key) out[String(r.key)] = r.value; });
  return makeRes(out);
}
function saveSettings(data, updatedBy) {
  if (!data || typeof data !== 'object') return makeErr('ต้องส่ง data เป็น object ของ key/value');
  const sheet   = getSheet(S.SETTINGS);
  const now     = new Date().toISOString();
  let rows      = sheet.getDataRange().getValues();
  if (rows.length === 0) { sheet.appendRow(['key','value','updated_by','updated_at']); rows = sheet.getDataRange().getValues(); }
  const iKey = rows[0].indexOf('key');
  Object.keys(data).forEach(k => {
    let found = -1;
    for (let i = 1; i < rows.length; i++) { if (String(rows[i][iKey]) === k) { found = i + 1; break; } }
    const rowData = [k, data[k], updatedBy || '', now];
    if (found > 0) sheet.getRange(found, 1, 1, rowData.length).setValues([rowData]);
    else { sheet.appendRow(rowData); rows = sheet.getDataRange().getValues(); }
  });
  return makeRes({ saved: true, updated_at: now });
}

// ════════════════════════════════════════
// RENT DISCOUNTS — ส่วนลดค่าเช่ารายเดือน (เพิ่ม 2026-07-26)
// ขอบเขตตามข้อกำหนดของผู้ดูแลตลาด:
//  · กำหนดได้ 2 ระดับ: 'market' (ทุกล็อคเท่ากันทั้งตลาดในเดือนนั้น) และ 'lock' (เฉพาะล็อค)
//  · หน่วยเป็น "จำนวนเงินบาท" เท่านั้น (ไม่มีเปอร์เซ็นต์ ตามที่ยืนยัน 2026-07-26)
//  · ใช้ได้เฉพาะเดือนปัจจุบันหรือเดือนอนาคต — ห้ามให้ส่วนลดย้อนหลังเด็ดขาด (ตรวจที่ backend
//    ไม่ใช่แค่ที่หน้าเว็บ เพราะหน้าเว็บถูก bypass ได้)
//  · ส่วนลดระดับล็อคชนะส่วนลดทั้งตลาดเสมอ (specific wins over general)
//  · ล็อคที่อยู่ระหว่างผ่อนชำระ: ได้ส่วนลดหรือไม่ ขึ้นกับ flag apply_installment ของรายการนั้น
// ════════════════════════════════════════
function getDiscounts(month) {
  let rows = _sheetToObjects(S.DISCOUNT).filter(r => String(r.status || 'active') !== 'deleted');
  rows = rows.map(r => ({
    id: r.id, month: String(r.month || '').slice(0, 7), scope: r.scope, lock_id: r.lock_id || '',
    amount: parseFloat(r.amount) || 0,
    apply_installment: (r.apply_installment === true || String(r.apply_installment).toUpperCase() === 'TRUE'),
    note: r.note || '', created_by: r.created_by || '', created_at: r.created_at, updated_at: r.updated_at,
  }));
  if (month) rows = rows.filter(r => r.month === String(month).slice(0, 7));
  return makeRes(rows);
}

function saveDiscount(data) {
  if (!data) return makeErr('ไม่มีข้อมูลส่วนลด');
  const month = String(data.month || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return makeErr('รูปแบบเดือนต้องเป็น YYYY-MM');
  if (month < _thisMonthISO()) return makeErr('ไม่สามารถกำหนดส่วนลดย้อนหลังได้ — ใช้ได้เฉพาะเดือนปัจจุบันหรือเดือนในอนาคต');
  const scope = (data.scope === 'market') ? 'market' : 'lock';
  if (scope === 'lock' && !data.lock_id) return makeErr('ส่วนลดรายล็อคต้องระบุ lock_id');
  const amount = parseFloat(data.amount) || 0;
  if (amount < 0) return makeErr('จำนวนส่วนลดต้องไม่ติดลบ');

  const sheet = getSheet(S.DISCOUNT);
  let rows = sheet.getDataRange().getValues();
  if (rows.length === 0) {
    sheet.appendRow(['id','month','scope','lock_id','amount','apply_installment','note','status','created_by','created_at','updated_at']);
    rows = sheet.getDataRange().getValues();
  }
  const headers = rows[0];
  const iMonth = headers.indexOf('month'), iScope = headers.indexOf('scope'),
        iLock  = headers.indexOf('lock_id'), iStatus = headers.indexOf('status'),
        iId    = headers.indexOf('id'), iCreated = headers.indexOf('created_at');
  // upsert: 1 เดือน มีส่วนลดทั้งตลาดได้ 1 รายการ และส่วนลดรายล็อคได้ล็อคละ 1 รายการ
  let foundRow = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][iStatus] || 'active') === 'deleted') continue;
    if (String(rows[i][iMonth]).slice(0, 7) !== month) continue;
    if (String(rows[i][iScope]) !== scope) continue;
    if (scope === 'lock' && String(rows[i][iLock]) !== String(data.lock_id)) continue;
    foundRow = i + 1; break;
  }
  const now = new Date().toISOString();
  const id  = foundRow > 0 ? (rows[foundRow - 1][iId] || ('DC' + Date.now())) : ('DC' + Date.now());
  const merged = {
    id: id, month: month, scope: scope, lock_id: scope === 'lock' ? data.lock_id : '',
    amount: amount,
    apply_installment: data.apply_installment === true || String(data.apply_installment).toUpperCase() === 'TRUE',
    note: data.note || '', status: 'active', created_by: data.created_by || '',
    created_at: foundRow > 0 ? (rows[foundRow - 1][iCreated] || now) : now, updated_at: now,
  };
  const rowData = headers.map(h => merged[h] !== undefined ? merged[h] : '');
  if (foundRow > 0) sheet.getRange(foundRow, 1, 1, rowData.length).setValues([rowData]);
  else sheet.appendRow(rowData);
  return makeRes({ id: id, action: foundRow > 0 ? 'updated' : 'created', month: month, scope: scope });
}

function deleteDiscount(id) {
  if (!id) return makeErr('ต้องระบุ id');
  const sheet   = getSheet(S.DISCOUNT);
  const rows    = sheet.getDataRange().getValues();
  if (rows.length <= 1) return makeErr('ไม่พบรายการส่วนลด');
  const headers = rows[0];
  const iId = headers.indexOf('id'), iMonth = headers.indexOf('month');
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][iId]) !== String(id)) continue;
    // ห้ามลบส่วนลดของเดือนที่ผ่านไปแล้ว เพื่อรักษาความถูกต้องของรายงานย้อนหลัง
    if (String(rows[i][iMonth]).slice(0, 7) < _thisMonthISO()) {
      return makeErr('ไม่สามารถลบส่วนลดของเดือนที่ผ่านไปแล้วได้ (รายงานย้อนหลังต้องคงค่าเดิม)');
    }
    sheet.deleteRow(i + 1);
    return makeRes({ deleted: id });
  }
  return makeErr('ไม่พบรายการส่วนลด: ' + id);
}

// ════════════════════════════════════════
// USERS
// ════════════════════════════════════════
// ── Password hashing helpers (เพิ่ม 2026-07-14 — แก้บั๊ก #20: รหัสผ่าน plain text) ──
// SHA-256 + random salt ต่อผู้ใช้ 1 คน เก็บ hash ไว้ในคอลัมน์ 'password' และ salt แยกในคอลัมน์ 'salt'
// ใช้ Utilities ที่มีอยู่แล้วใน Apps Script — ไม่ต้องเพิ่ม library ภายนอก (คงความเรียบง่ายของสถาปัตยกรรม)
function hashPassword(password, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password) + String(salt), Utilities.Charset.UTF_8);
  return bytes.map(function(b) { return ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0'); }).join('');
}
function generateSalt() {
  return Utilities.getUuid().replace(/-/g, '');
}

function getUsers() {
  const sheet = getSheet(S.USERS);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return makeRes([]);
  const headers = rows[0];
  const users = rows.slice(1).map(row => {
    const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]);
    return obj;
  });
  // ไม่ส่ง password/salt กลับ (security)
  return makeRes(users.map(u=>({...u, password:'***', salt:undefined})));
}

function verifyUser(username, password) {
  const sheet = getSheet(S.USERS);
  const rows  = sheet.getDataRange().getValues();
  const headers = rows[0];
  const userIdx = headers.indexOf('username');
  const pwIdx   = headers.indexOf('password');
  const saltIdx = headers.indexOf('salt');
  const roleIdx = headers.indexOf('role');
  const nameIdx = headers.indexOf('display_name');
  const rlIdx   = headers.indexOf('role_label');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][userIdx] !== username) continue;
    const stored = rows[i][pwIdx];
    const salt   = saltIdx >= 0 ? rows[i][saltIdx] : '';
    // แถวที่ยังไม่ผ่านการ migrate (ไม่มี salt) จะถูกเทียบแบบ plain text ครั้งเดียว
    // แล้วอัปเกรดเป็น hash ทันทีเมื่อล็อกอินสำเร็จ (self-healing migration)
    const match = salt ? (hashPassword(password, salt) === stored) : (stored === password);
    if (!match) return makeRes(null, 'invalid');
    if (!salt) {
      const newSalt = generateSalt();
      sheet.getRange(i + 1, pwIdx + 1).setValue(hashPassword(password, newSalt));
      if (saltIdx >= 0) sheet.getRange(i + 1, saltIdx + 1).setValue(newSalt);
    }
    return makeRes({
      username:    rows[i][userIdx],
      role:        rows[i][roleIdx],
      displayName: rows[i][nameIdx],
      roleLabel:   rows[i][rlIdx],
    });
  }
  return makeRes(null, 'invalid');
}

function changePassword(username, oldPw, newPw) {
  const sheet   = getSheet(S.USERS);
  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const userIdx = headers.indexOf('username');
  const pwIdx   = headers.indexOf('password');
  const saltIdx = headers.indexOf('salt');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][userIdx] === username) {
      const stored = rows[i][pwIdx];
      const salt   = saltIdx >= 0 ? rows[i][saltIdx] : '';
      const match  = salt ? (hashPassword(oldPw, salt) === stored) : (stored === oldPw);
      if (!match) return makeErr('Wrong current password');
      const newSalt = generateSalt();
      sheet.getRange(i + 1, pwIdx + 1).setValue(hashPassword(newPw, newSalt));
      if (saltIdx >= 0) {
        sheet.getRange(i + 1, saltIdx + 1).setValue(newSalt);
      } else {
        sheet.getRange(1, headers.length + 1).setValue('salt');
        sheet.getRange(i + 1, headers.length + 1).setValue(newSalt);
      }
      return makeRes({ changed: true });
    }
  }
  return makeErr('User not found');
}

// ── One-time migration: แปลงรหัสผ่าน plain text เดิมในชีตให้เป็น hash+salt ──
// เรียกครั้งเดียวหลัง deploy โค้ดนี้ครั้งแรก โดยเปิด URL เว็บแอปนี้ + '?action=migrateHashPasswords'
// บนเบราว์เซอร์ (GET request) — ทำงานแบบ idempotent: แถวที่มี salt อยู่แล้วจะถูกข้าม ปลอดภัยแม้เรียกซ้ำ
function migrateHashPasswords() {
  const sheet = getSheet(S.USERS);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length === 0) return makeRes({ migrated: 0, note: 'users sheet ว่างเปล่า' });
  const headers = rows[0];
  let pwIdx   = headers.indexOf('password');
  let saltIdx = headers.indexOf('salt');
  if (pwIdx < 0) return makeErr("ไม่พบคอลัมน์ 'password' ใน sheet users");
  if (saltIdx < 0) {
    saltIdx = headers.length;
    sheet.getRange(1, saltIdx + 1).setValue('salt');
  }
  let migrated = 0;
  for (let i = 1; i < rows.length; i++) {
    const currentSalt = saltIdx < rows[i].length ? rows[i][saltIdx] : '';
    if (currentSalt) continue; // แถวนี้ hash แล้ว ข้าม
    const plain = rows[i][pwIdx];
    if (!plain) continue;
    const newSalt = generateSalt();
    sheet.getRange(i + 1, pwIdx + 1).setValue(hashPassword(String(plain), newSalt));
    sheet.getRange(i + 1, saltIdx + 1).setValue(newSalt);
    migrated++;
  }
  return makeRes({ migrated: migrated, totalUsers: rows.length - 1 });
}

// ════════════════════════════════════════
// INSTALLMENT PLANS (เพิ่ม 2026-07-14 — แก้บั๊ก #19)
// ════════════════════════════════════════
function getInstallmentPlans() {
  const sheet = getSheet(S.INSTALL);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return makeRes([]);
  const headers = rows[0];
  const plans = rows.slice(1).map(row => {
    const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]);
    return obj;
  }).filter(p => p.status !== 'cancelled');
  return makeRes(plans);
}

function saveInstallmentPlan(data) {
  const sheet   = getSheet(S.INSTALL);
  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const now     = new Date().toISOString();
  const lockIdx = headers.indexOf('lock_id');
  let foundRow = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][lockIdx] === data.lock_id) { foundRow = i + 1; break; }
  }
  const merged = {
    lock_id: data.lock_id,
    terms: data.terms,
    first_amount: data.first_amount || 0,
    start_date: data.start_date,
    deadline: data.deadline,
    status: data.status || 'active',
    created_at: (foundRow > 0 ? rows[foundRow-1][headers.indexOf('created_at')] : now) || now,
    updated_at: now,
  };
  const rowData = headers.map(h => merged[h] !== undefined ? merged[h] : '');
  if (foundRow > 0) {
    sheet.getRange(foundRow, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }
  return makeRes({ action: foundRow > 0 ? 'updated' : 'created', lock_id: data.lock_id });
}

function deleteInstallmentPlan(lockId) {
  const sheet   = getSheet(S.INSTALL);
  const rows    = sheet.getDataRange().getValues();
  const lockIdx = rows[0].indexOf('lock_id');
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][lockIdx] === lockId) {
      sheet.deleteRow(i + 1);
      return makeRes({ deleted: lockId });
    }
  }
  return makeErr('Plan not found: ' + lockId);
}

// ════════════════════════════════════════
// GENERIC HELPER — อ่าน sheet เป็น array ของ object (ใช้ภายในเท่านั้น)
// ════════════════════════════════════════
function _sheetToObjects(sheetName) {
  const sheet = getSheet(sheetName);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {}; headers.forEach((h, i) => obj[h] = row[i]); return obj;
  });
}

// ════════════════════════════════════════
// FLOATING LOT QUEUE — คิวจองล็อคจร (เพิ่ม 2026-07-21)
// แยกจาก daily_bookings เดิมโดยสิ้นเชิงในเชิง "สถานะคิว" (waiting/sold/cancelled)
// แต่เมื่อ "ขาย" สำเร็จ (sellFloatingQueueEntry) จะเรียก saveDailyBooking เดิมควบคู่ไปด้วยเสมอ
// เพื่อให้ผังตลาด/รายงาน/หน้าอื่น ๆ ที่อ่าน daily_bookings อยู่แล้วเห็นข้อมูลตรงกัน
// ไม่สร้างระบบข้อมูลคู่ขนานที่ไม่ตรงกัน — ห้ามลบ/แก้ logic ของ saveDailyBooking/cancelDailyBooking เดิม
// ════════════════════════════════════════
function getFloatingQueue(opt) {
  let data = _sheetToObjects(S.QUEUE).filter(r => r.status !== 'cancelled');
  data = data.map(r => { r.phone = _normPhone(r.phone); r.date_iso = _normDate(r.market_date); return r; });
  if (opt) data = data.filter(r => _matchDate(r.market_date, opt));
  return makeRes(data);
}

function saveFloatingQueueEntry(data) {
  // เพิ่มคิวรอใหม่ (ผู้จัดคีย์จากคำขอในกลุ่มไลน์) — สถานะเริ่มต้นเสมอคือ waiting
  const sheet = getSheet(S.QUEUE);
  const id    = 'FQ' + Date.now();
  const now   = new Date().toISOString();
  _forceTextCol(sheet, 'phone');
  sheet.appendRow([id, data.market_date, data.vendor_name, _normPhone(data.phone), data.line || '',
                   data.zone_pref || '', data.note || '', data.requested_at || now,
                   'waiting', '', 0, 0, 0, '', '', '', '', now]);
  return makeRes({ id });
}

function _findQueueRow(sheet, id) {
  const rows  = sheet.getDataRange().getValues();
  const idIdx = rows[0].indexOf('id');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idIdx] === id) return { rowNum: i + 1, headers: rows[0], row: rows[i] };
  }
  return null;
}

function sellFloatingQueueEntry(data) {
  // data: { id, assigned_lock, zone, vendor_name, phone, product, price, elec, total, method, date, time, sold_by }
  // ผู้จัดเลือกขายแถวใดก่อนก็ได้ ไม่ต้องเรียงตามคิว (ข้อกำหนด: ข้ามคิวได้)
  const sheet = getSheet(S.QUEUE);
  _ensureColumn(sheet, 'product');   // เพิ่ม 2026-07-26: เดิมไม่มีคอลัมน์นี้ ทำให้ตาราง "ขายแล้ว" แสดงสินค้าว่าง
  _ensureColumn(sheet, 'zone');
  const found = _findQueueRow(sheet, data.id);
  if (!found) return makeErr('ไม่พบรายการคิว: ' + data.id);
  const { rowNum, headers } = found;
  const now = new Date().toISOString();
  const set = (col, val) => { const i = headers.indexOf(col); if (i >= 0) sheet.getRange(rowNum, i + 1).setValue(val); };
  set('status', 'sold');
  set('assigned_lock', data.assigned_lock);
  set('product', data.product || '');
  set('zone', data.zone || '');
  set('price', data.price || 0);
  set('elec', data.elec || 0);
  set('total', data.total || 0);
  set('method', data.method || '');
  set('sold_by', data.sold_by || '');
  set('sold_at', now);
  set('updated_at', now);
  // sync กับกลไก daily_bookings เดิม (ดูหมายเหตุด้านบน)
  saveDailyBooking({
    lock_id: data.assigned_lock, zone: data.zone || '', vendor_name: data.vendor_name,
    phone: data.phone || '', product: data.product, price: data.price, elec: data.elec || 0,
    total: data.total, method: data.method, date: data.date, time: data.time,
    original_status: data.original_status || '',
  });
  return makeRes({ id: data.id, assigned_lock: data.assigned_lock });
}

function editFloatingQueueEntry(id, data) {
  // แก้ไขคิว "รอ" หรือคิวที่ "ขายแล้ว" ก็ได้ (ตามข้อกำหนด: ต้องแก้ไขได้แม้กดบันทึกไปแล้ว)
  const sheet = getSheet(S.QUEUE);
  const found = _findQueueRow(sheet, id);
  if (!found) return makeErr('ไม่พบรายการคิว: ' + id);
  const { rowNum, headers, row } = found;
  const existing = {}; headers.forEach((h, i) => existing[h] = row[i]);
  const prevLock = existing.assigned_lock, prevDate = existing.market_date;
  const now = new Date().toISOString();
  const merged = Object.assign({}, existing, data, { updated_at: now });
  const rowData = headers.map(h => merged[h] !== undefined ? merged[h] : '');
  sheet.getRange(rowNum, 1, 1, rowData.length).setValues([rowData]);
  // ถ้ารายการนี้เคยขายแล้วและมีการเปลี่ยนล็อค ต้อง sync กับ daily_bookings: คืนล็อคเดิม + บันทึกล็อคใหม่
  if (existing.status === 'sold' && data.assigned_lock && data.assigned_lock !== prevLock) {
    cancelDailyBooking(prevLock, prevDate);
    saveDailyBooking({
      lock_id: data.assigned_lock, zone: data.zone || existing.zone_pref || '',
      vendor_name: merged.vendor_name, phone: merged.phone || '', product: data.product || '',
      price: merged.price || 0, elec: merged.elec || 0, total: merged.total || 0,
      method: merged.method || '', date: merged.market_date, time: data.time || '',
      original_status: '',
    });
  }
  return makeRes({ id, updated: true });
}

function cancelFloatingQueueEntry(id, reason) {
  // ยกเลิกคิว ไม่ว่าจะยัง waiting หรือ sold ไปแล้วก็ตาม — ถ้า sold แล้วต้องคืนล็อคเป็นว่างใน daily_bookings ด้วย
  const sheet = getSheet(S.QUEUE);
  const found = _findQueueRow(sheet, id);
  if (!found) return makeErr('ไม่พบรายการคิว: ' + id);
  const { rowNum, headers, row } = found;
  const existing = {}; headers.forEach((h, i) => existing[h] = row[i]);
  if (existing.status === 'sold' && existing.assigned_lock) {
    cancelDailyBooking(existing.assigned_lock, existing.market_date);
  }
  const now = new Date().toISOString();
  const set = (col, val) => { const i = headers.indexOf(col); if (i >= 0) sheet.getRange(rowNum, i + 1).setValue(val); };
  set('status', 'cancelled');
  set('cancel_reason', reason || '');
  set('updated_at', now);
  return makeRes({ id, cancelled: true });
}

// ════════════════════════════════════════
// MARKET RULES — กฎระเบียบตลาด (เพิ่ม 2026-07-21)
// เก็บเป็นแถวเดียว (singleton) เพราะฐานข้อมูลแยกกันอยู่แล้วต่อหนึ่งตลาด (ดูคู่มือหัวข้อ 8)
// ════════════════════════════════════════
function getMarketRules() {
  const rows = _sheetToObjects(S.RULES);
  if (!rows.length) return makeRes({ content: '', updated_by: '', updated_at: '' });
  return makeRes(rows[0]);
}

function saveMarketRules(content, updatedBy) {
  const sheet   = getSheet(S.RULES);
  const now     = new Date().toISOString();
  const rows    = sheet.getDataRange().getValues();
  const rowData = [content || '', updatedBy || '', now];
  if (rows.length <= 1) {
    sheet.appendRow(rowData);
  } else {
    sheet.getRange(2, 1, 1, rowData.length).setValues([rowData]);
  }
  return makeRes({ saved: true, updated_at: now });
}

// ════════════════════════════════════════
// PUBLIC STATUS — หน้าสถานะสาธารณะ pamai_thu_public_status.html (เพิ่ม 2026-07-21)
// action นี้ถูกยกเว้นการเช็ค token ใน doGet โดยเจตนา (ดู PUBLIC_ACTIONS ด้านบนไฟล์)
// กฎสำคัญที่ห้ามละเมิด: ห้ามใส่ phone / line / unpaid_* / password / salt ลงในผลลัพธ์นี้เด็ดขาด
// เพราะใครก็เปิดดูได้โดยไม่ต้อง login — ลิงก์หน้านี้จะถูกส่งเข้ากลุ่มไลน์สาธารณะของผู้ค้า
// ════════════════════════════════════════
function getPublicStatus(date) {
  const cache    = CacheService.getScriptCache();
  const cacheKey = 'pubStatus_' + (date || 'nodate');
  const hit = cache.get(cacheKey); // แคช 20 วิ กันโหลด Sheets ถี่เกินไปตอนมีคนเปิดพร้อมกันจากกลุ่มไลน์
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);

  // ── ผู้ค้าประจำ: whitelist ฟิลด์ (ไม่ใช่ blacklist) เพื่อกันข้อมูลอ่อนไหวหลุดในอนาคต ──
  const vendorsPublic = _sheetToObjects(S.VENDORS)
    .filter(v => v.status !== 'terminated')
    .map(v => ({ lock: v.lock, zone: v.zone, name: v.name, product: v.product, status: v.status }));

  // ── ลา/ขาดล็อค: หาสถานะล่าสุดของแต่ละล็อคในวันที่ระบุ (ตรรกะเดียวกับที่ผังตลาดใช้ในฝั่ง frontend) ──
  let leaveRows = _sheetToObjects(S.LEAVE);
  if (date) leaveRows = leaveRows.filter(r => _normDate(r.date) === _normDate(date));
  leaveRows = leaveRows.slice().sort((a, b) => String(a.created_at || a.time).localeCompare(String(b.created_at || b.time)));
  const lockLeaveStatus = {};
  leaveRows.forEach(r => {
    if (!r.lock_id) return;
    if (r.type === 'leave' || r.type === 'absent') {
      lockLeaveStatus[r.lock_id] = { type: r.type, note: r.note || '', date: r.date };
    } else if (_CANCEL_TYPES.indexOf(String(r.type)) >= 0) {
      // รวม leave_cancel/absent_cancel ของแอพวันพฤหัสฯ เดิมด้วย (เดิมเช็คแค่ 'cancel' ทำให้สถานะค้าง)
      delete lockLeaveStatus[r.lock_id];
    }
  });

  // ── คิวจองล็อคจร: รอคิว + ขายแล้ว (ไม่ส่งเบอร์โทร/LINE) ──
  let queueRows = _sheetToObjects(S.QUEUE).filter(r => r.status !== 'cancelled');
  if (date) queueRows = queueRows.filter(r => _normDate(r.market_date) === _normDate(date));
  const queuePublic = queueRows.map(r => ({
    id: r.id, zone_pref: r.zone_pref || 'ได้ทุกโซน', note: r.note || '',
    vendor_name: r.vendor_name, status: r.status, assigned_lock: r.assigned_lock || '',
    product: r.product || '', requested_at: r.requested_at,
  }));

  // ── ล็อคจรที่ขายแล้วทั้งหมดของวันนั้น (เพิ่ม 2026-07-26 ตามข้อกำหนด) ──
  // ต้องแสดงทั้ง 2 ช่องทาง: (ก) ขายผ่านคิวรอในระบบ (ข) ผู้จัดขายตรงไม่ผ่านคิว
  // แหล่งข้อมูลจริงคือ daily_bookings (ทุกการขายลงที่นี่เสมอ ทั้งสองช่องทาง — ดูหมายเหตุ sellFloatingQueueEntry)
  // แล้วเทียบกับ floating_queue เพื่อบอกช่องทางว่ามาจากคิวหรือขายตรง
  // whitelist: เลขล็อค + ชื่อร้าน + สินค้า + ช่องทาง เท่านั้น — ห้ามส่ง phone/price/total/method ออกหน้าสาธารณะ
  let soldRows = _sheetToObjects(S.DAILY)
    .filter(r => r.cancelled !== true && String(r.cancelled).toUpperCase() !== 'TRUE');
  if (date) soldRows = soldRows.filter(r => _normDate(r.date) === _normDate(date));
  const queueSoldLocks = {};
  queueRows.forEach(r => {
    if (r.status === 'sold' && r.assigned_lock) {
      queueSoldLocks[r.assigned_lock] = String(r.note || '').indexOf('ขายตรง') >= 0 ? 'direct' : 'queue';
    }
  });
  const soldPublic = soldRows.map(r => ({
    lock: r.lock_id, zone: r.zone || '', vendor_name: r.vendor_name || '', product: r.product || '',
    via: queueSoldLocks[r.lock_id] === 'queue' ? 'queue' : 'direct',
    time: r.time || '',
  }));

  // ── กฎระเบียบตลาด ──
  const rulesRows = _sheetToObjects(S.RULES);
  const rules = rulesRows.length
    ? { content: rulesRows[0].content || '', updated_by: rulesRows[0].updated_by || '', updated_at: rulesRows[0].updated_at || '' }
    : { content: '', updated_by: '', updated_at: '' };

  const payload = {
    date: date || '',
    vendors: vendorsPublic,
    leaveStatus: lockLeaveStatus,
    queue: queuePublic,
    sold: soldPublic,
    rules: rules,
    generatedAt: new Date().toISOString(),
  };
  const out = JSON.stringify({ status: 'ok', data: payload, ts: new Date().toISOString() });
  cache.put(cacheKey, out, 10);   // ลดจาก 20 → 10 วิ ให้หน้าสาธารณะใกล้เรียลไทม์ขึ้นตามที่ผู้ใช้ขอ
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}
