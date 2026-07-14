// ═══════════════════════════════════════════════════════════════
// แพไม้มินิ วันพฤหัสบดี — Google Apps Script (Backend API)
// วางโค้ดนี้ใน Google Apps Script แล้ว Deploy as Web App
//
// อัปเดต 14 ก.ค. 2569:
//  - เพิ่ม validation ใน saveVendor() กันข้อมูลไม่สมบูรณ์เข้าฐานข้อมูลจริง (แก้ B-10 ไม่ให้เกิดซ้ำ)
//  - เปลี่ยนรหัสผ่านผู้ใช้จาก plain text เป็น SHA-256 hash พร้อม auto-upgrade ตอน login ครั้งถัดไป (แก้ B-12)
//  - เพิ่มฟังก์ชัน migrateAllPasswordsNow() สำหรับแปลงรหัสผ่านเดิมทั้งหมดเป็น hash ทันทีโดยไม่ต้องรอ login
// ═══════════════════════════════════════════════════════════════

const SHEET_ID = '1o-pBCouIVr2d8UEI33rVXOZf1Ij3b2JxcjrbgBmpMN8'; // Paemai Market Database (Thursday) — สร้างแยกต่างหากจากตลาดวันอังคารแล้ว

// ── Sheet names ──
const S = {
  VENDORS:  'vendors',
  LEAVE:    'leave_log',
  DAILY:    'daily_bookings',
  PAYMENTS: 'payments',
  ACTIVITY: 'activity_log',
  USERS:    'users',
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

// ── GET Router ──
function doGet(e) {
  try {
    const action = e.parameter.action || '';
    switch(action) {
      case 'getVendors':    return getVendors();
      case 'getLeaveLog':   return getLeaveLog(e.parameter.date, e.parameter.lockId);
      case 'getDailyBookings': return getDailyBookings(e.parameter.date, e.parameter.lockId);
      case 'getPayments':   return getPayments(e.parameter.date);
      case 'getUsers':      return getUsers();
      case 'initSheets':    return initSheets();
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

// ป้องกันกรณี sheet ยังไม่เคยถูก initSheets() มาก่อน — ถ้าไม่มี header แถวแรกเลย ให้ใส่ headers ให้ก่อน appendRow
// (ถ้าไม่มีขั้นตอนนี้ แถวข้อมูลจริงแถวแรกจะกลายเป็น header โดยไม่ตั้งใจ ทำให้อ่านข้อมูลผิดพลาดภายหลัง)
function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
}

// ════════════════════════════════════════
// PASSWORD HASHING (B-12) — SHA-256
// ════════════════════════════════════════
// แปลงข้อความเป็น SHA-256 hash แบบ hex string 64 ตัวอักษร
function sha256(str) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(str), Utilities.Charset.UTF_8);
  return raw.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

// ตรวจว่าข้อความมีรูปแบบเป็น SHA-256 hash แล้วหรือยัง (hex 64 ตัวอักษร) — ใช้แยกบัญชีเก่า (plain text) จากบัญชีที่ผ่านการ hash แล้ว
function looksHashed(str) {
  return /^[0-9a-f]{64}$/i.test(String(str));
}

// เรียกฟังก์ชันนี้เอง "ครั้งเดียว" จาก Apps Script editor (เลือกฟังก์ชัน migrateAllPasswordsNow แล้วกด Run)
// เพื่อแปลงรหัสผ่าน plain text ที่เหลืออยู่ทั้งหมดในชีต users ให้เป็น SHA-256 hash ทันที
// โดยไม่ต้องรอให้ผู้ใช้แต่ละคน login ผ่านระบบก่อน (ซึ่งจะ auto-upgrade ให้เองอยู่แล้วผ่าน verifyUser)
function migrateAllPasswordsNow() {
  const sheet   = getSheet(S.USERS);
  const rows    = sheet.getDataRange().getValues();
  if (rows.length <= 1) { Logger.log('ไม่มีผู้ใช้ในระบบ'); return 0; }
  const headers = rows[0];
  const pwIdx   = headers.indexOf('password');
  let migrated = 0;
  for (let i = 1; i < rows.length; i++) {
    const stored = rows[i][pwIdx];
    if (stored && !looksHashed(stored)) {
      sheet.getRange(i + 1, pwIdx + 1).setValue(sha256(stored));
      migrated++;
    }
  }
  Logger.log('แปลงรหัสผ่านเป็น SHA-256 hash แล้ว ' + migrated + ' บัญชี');
  return migrated;
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
  // หมายเหตุ: ผู้ใช้จริงถูกกรอกไว้ใน Google Sheet โดยตรงแล้ว (ไม่เก็บ password ไว้ในโค้ดเพื่อความปลอดภัย)
  // หากต้องตั้งค่าระบบใหม่ตั้งแต่ต้น ให้เพิ่มผู้ใช้เองในแท็บ users ของ Google Sheet ตามโครงสร้างคอลัมน์ด้านล่าง
  const uSheet = getSheet(S.USERS);
  if (uSheet.getLastRow() === 0) {
    uSheet.appendRow(['username','password','role','display_name','role_label','created_at']);
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
  // ── Validation (กัน B-10: ข้อมูลไม่สมบูรณ์/ทดสอบเข้าฐานข้อมูลจริงซ้ำ) ──
  // เหตุผล: เคยพบข้อมูลผู้ค้า 16 รายการที่ไม่มีเลขล็อครูปแบบถูกต้อง หรือไม่มีทั้งชื่อและสินค้าเลย
  // ปนอยู่ในฐานข้อมูลจริง (ดูหัวข้อ 12 กรณี B-10 ในคู่มือ) จึงเพิ่มการตรวจสอบขั้นต่ำนี้ก่อนบันทึกทุกครั้ง
  if (!data || data.lock === undefined || data.lock === null || String(data.lock).trim() === '') {
    return makeErr('ต้องระบุเลขล็อค (lock) ก่อนบันทึกข้อมูลผู้ค้า');
  }

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

  // สำหรับการ "สร้างผู้ค้าใหม่" เท่านั้น (ไม่ใช่การอัปเดตข้อมูลบางส่วน เช่นจากหน้ารับชำระ)
  // ต้องมีอย่างน้อยชื่อผู้ค้า หรือ สินค้า อย่างใดอย่างหนึ่ง มิฉะนั้นถือว่าเป็นข้อมูลไม่สมบูรณ์
  if (foundRow === -1) {
    const hasName    = data.name    !== undefined && String(data.name).trim()    !== '';
    const hasProduct = data.product !== undefined && String(data.product).trim() !== '';
    if (!hasName && !hasProduct) {
      return makeErr('ต้องระบุชื่อผู้ค้าหรือสินค้าอย่างน้อยหนึ่งอย่างสำหรับการลงทะเบียนผู้ค้าใหม่');
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
  if (date)   data = data.filter(r => r.date === date);
  if (lockId) data = data.filter(r => r.lock_id === lockId);
  return makeRes(data);
}

function logLeave(data) {
  const sheet = getSheet(S.LEAVE);
  ensureHeaders(sheet, ['id','lock_id','zone','shop','type','note','manager','date','time','created_at']);
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
  });
  // เมื่อดูประวัติเจาะจงล็อค (lockId) ให้เห็นทั้งหมดรวมที่ยกเลิกแล้วด้วย
  // แต่โหมดปกติ (เช็คว่าล็อคไหนมีจรอยู่วันนี้) ยังกรองเฉพาะที่ active เหมือนเดิม
  if (!lockId) data = data.filter(r => r.cancelled !== true && r.cancelled !== 'TRUE');
  if (date)    data = data.filter(r => r.date === date);
  if (lockId)  data = data.filter(r => r.lock_id === lockId);
  return makeRes(data);
}

function saveDailyBooking(data) {
  const sheet = getSheet(S.DAILY);
  ensureHeaders(sheet, ['id','lock_id','zone','vendor_name','phone','product',
                    'price','elec','total','method','date','time',
                    'original_status','cancelled','created_at']);
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
function getUsers() {
  const sheet = getSheet(S.USERS);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return makeRes([]);
  const headers = rows[0];
  const users = rows.slice(1).map(row => {
    const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]);
    return obj;
  });
  // ไม่ส่ง password กลับ (security)
  return makeRes(users.map(u=>({...u, password:'***'})));
}

// B-12: รหัสผ่านในชีตอาจเป็น plain text (บัญชีเก่า) หรือ SHA-256 hash (บัญชีที่ผ่านการ login/migrate แล้ว)
// ตรวจสอบทั้งสองแบบ แล้ว "auto-upgrade" เป็น hash ทันทีเมื่อ login สำเร็จด้วยรหัสผ่าน plain text เดิม
// เพื่อค่อยๆ ลดจำนวนรหัสผ่าน plain text ที่เหลือในระบบโดยไม่ต้องบังคับผู้ใช้เปลี่ยนรหัสเอง
function verifyUser(username, password) {
  const sheet = getSheet(S.USERS);
  const rows  = sheet.getDataRange().getValues();
  const headers = rows[0];
  const userIdx = headers.indexOf('username');
  const pwIdx   = headers.indexOf('password');
  const roleIdx = headers.indexOf('role');
  const nameIdx = headers.indexOf('display_name');
  const rlIdx   = headers.indexOf('role_label');
  const hashedInput = sha256(password);

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][userIdx] !== username) continue;

    const stored      = rows[i][pwIdx];
    const isHashMatch  = stored === hashedInput;
    const isPlainMatch = !looksHashed(stored) && stored === password;

    if (isHashMatch || isPlainMatch) {
      if (isPlainMatch) {
        // auto-upgrade: แปลงรหัสผ่าน plain text เดิมเป็น SHA-256 hash ทันทีที่ login สำเร็จ
        sheet.getRange(i + 1, pwIdx + 1).setValue(hashedInput);
      }
      return makeRes({
        username:    rows[i][userIdx],
        role:        rows[i][roleIdx],
        displayName: rows[i][nameIdx],
        roleLabel:   rows[i][rlIdx],
      });
    }
    // username ตรงแต่รหัสผ่านไม่ตรง — usernames ในระบบถือว่าไม่ซ้ำกัน จึงหยุดค้นหาต่อได้เลย
    break;
  }
  return makeRes(null, 'invalid');
}

function changePassword(username, oldPw, newPw) {
  const sheet   = getSheet(S.USERS);
  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const userIdx = headers.indexOf('username');
  const pwIdx   = headers.indexOf('password');
  const hashedOld = sha256(oldPw);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][userIdx] === username) {
      const stored = rows[i][pwIdx];
      const oldMatches = stored === hashedOld || (!looksHashed(stored) && stored === oldPw);
      if (!oldMatches) return makeErr('Wrong current password');
      sheet.getRange(i+1, pwIdx+1).setValue(sha256(newPw));
      return makeRes({ changed: true });
    }
  }
  return makeErr('User not found');
}
