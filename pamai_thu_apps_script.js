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
};

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
      case 'getLeaveLog':   return getLeaveLog(e.parameter.date, e.parameter.lockId);
      case 'getDailyBookings': return getDailyBookings(e.parameter.date, e.parameter.lockId);
      case 'getPayments':   return getPayments(e.parameter.date);
      case 'getUsers':      return getUsers();
      case 'initSheets':    return initSheets();
      case 'migrateHashPasswords': return migrateHashPasswords();
      case 'getInstallmentPlans': return getInstallmentPlans();
      case 'getFloatingQueue': return getFloatingQueue(e.parameter.date);
      case 'getMarketRules':   return getMarketRules();
      case 'getPublicStatus':  return getPublicStatus(e.parameter.date);
      default: return makeErr('Unknown action: ' + action);
    }
  } catch(err) {
    return makeErr(err.toString());
  }
}

// ── POST Router ──
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    if (!checkToken(body.token)) return makeErr('Unauthorized: invalid or missing token');
    const action = body.action || '';
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
    phone: data.phone !== undefined ? data.phone : (existing.phone || ''),
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
function getLeaveLog(date, lockId) {
  const sheet = getSheet(S.LEAVE);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return makeRes([]);
  const headers = rows[0];
  let data = rows.slice(1).map(row => {
    const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]); return obj;
  });
  if (date) data = data.filter(r => r.date === date);
  if (lockId) data = data.filter(r => r.lock_id === lockId);
  return makeRes(data);
}

function logLeave(data) {
  const sheet = getSheet(S.LEAVE);
  const id    = 'LV' + Date.now();
  const now   = new Date().toISOString();
  sheet.appendRow([id, data.lock_id, data.zone, data.shop, data.type,
                   data.note||'', data.manager||'', data.date, data.time, now]);
  return makeRes({ id });
}

// ════════════════════════════════════════
// DAILY BOOKINGS (ผู้ค้าจร)
// ════════════════════════════════════════
function getDailyBookings(date, lockId) {
  const sheet = getSheet(S.DAILY);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return makeRes([]);
  const headers = rows[0];
  let data = rows.slice(1).map(row => {
    const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]); return obj;
  }).filter(r => r.cancelled !== true && r.cancelled !== 'TRUE');
  if (date) data = data.filter(r => r.date === date);
  if (lockId) data = data.filter(r => r.lock_id === lockId);
  return makeRes(data);
}

function saveDailyBooking(data) {
  const sheet = getSheet(S.DAILY);
  const id    = 'DV' + Date.now();
  const now   = new Date().toISOString();
  sheet.appendRow([id, data.lock_id, data.zone, data.vendor_name, data.phone||'',
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
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][lockIdx] === lockId && rows[i][dateIdx] === date && rows[i][canIdx] !== true) {
      sheet.getRange(i+1, canIdx+1).setValue(true);
      return makeRes({ cancelled: lockId });
    }
  }
  return makeErr('Booking not found');
}

// ════════════════════════════════════════
// PAYMENTS
// ════════════════════════════════════════
function getPayments(date) {
  const sheet = getSheet(S.PAYMENTS);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return makeRes([]);
  const headers = rows[0];
  let data = rows.slice(1).map(row => {
    const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]); return obj;
  });
  if (date) data = data.filter(r => r.date === date);
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
function logActivity(data) {
  const sheet = getSheet(S.ACTIVITY);
  const id    = 'AC' + Date.now();
  sheet.appendRow([id, data.user||'system', data.type, data.message, data.detail||'', data.date, data.time]);
  return makeRes({ id });
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
function getFloatingQueue(date) {
  let data = _sheetToObjects(S.QUEUE).filter(r => r.status !== 'cancelled');
  if (date) data = data.filter(r => r.market_date === date);
  return makeRes(data);
}

function saveFloatingQueueEntry(data) {
  // เพิ่มคิวรอใหม่ (ผู้จัดคีย์จากคำขอในกลุ่มไลน์) — สถานะเริ่มต้นเสมอคือ waiting
  const sheet = getSheet(S.QUEUE);
  const id    = 'FQ' + Date.now();
  const now   = new Date().toISOString();
  sheet.appendRow([id, data.market_date, data.vendor_name, data.phone || '', data.line || '',
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
  const found = _findQueueRow(sheet, data.id);
  if (!found) return makeErr('ไม่พบรายการคิว: ' + data.id);
  const { rowNum, headers } = found;
  const now = new Date().toISOString();
  const set = (col, val) => { const i = headers.indexOf(col); if (i >= 0) sheet.getRange(rowNum, i + 1).setValue(val); };
  set('status', 'sold');
  set('assigned_lock', data.assigned_lock);
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
  if (date) leaveRows = leaveRows.filter(r => r.date === date);
  leaveRows = leaveRows.slice().sort((a, b) => String(a.created_at || a.time).localeCompare(String(b.created_at || b.time)));
  const lockLeaveStatus = {};
  leaveRows.forEach(r => {
    if (!r.lock_id) return;
    if (r.type === 'leave' || r.type === 'absent') {
      lockLeaveStatus[r.lock_id] = { type: r.type, note: r.note || '', date: r.date };
    } else if (r.type === 'cancel') {
      delete lockLeaveStatus[r.lock_id];
    }
  });

  // ── คิวจองล็อคจร: รอคิว + ขายแล้ว (ไม่ส่งเบอร์โทร/LINE) ──
  let queueRows = _sheetToObjects(S.QUEUE).filter(r => r.status !== 'cancelled');
  if (date) queueRows = queueRows.filter(r => r.market_date === date);
  const queuePublic = queueRows.map(r => ({
    id: r.id, zone_pref: r.zone_pref || 'ได้ทุกโซน', note: r.note || '',
    vendor_name: r.vendor_name, status: r.status, assigned_lock: r.assigned_lock || '',
    requested_at: r.requested_at,
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
    rules: rules,
    generatedAt: new Date().toISOString(),
  };
  const out = JSON.stringify({ status: 'ok', data: payload, ts: new Date().toISOString() });
  cache.put(cacheKey, out, 20);
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}
