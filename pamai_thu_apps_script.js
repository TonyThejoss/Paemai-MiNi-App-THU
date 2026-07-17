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
function doGet(e) {
  try {
    if (!checkToken(e.parameter.token)) return makeErr('Unauthorized: invalid or missing token');
    const action = e.parameter.action || '';
    switch(action) {
      case 'getVendors':    return getVendors();
      case 'getLeaveLog':   return getLeaveLog(e.parameter.date, e.parameter.lockId);
      case 'getDailyBookings': return getDailyBookings(e.parameter.date, e.parameter.lockId);
      case 'getPayments':   return getPayments(e.parameter.date);
      case 'getUsers':      return getUsers();
      case 'initSheets':    return initSheets();
      case 'migrateHashPasswords': return migrateHashPasswords();
      case 'getInstallmentPlans': return getInstallmentPlans();
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
