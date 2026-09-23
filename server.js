// เรียกใช้ library express ที่ติดตั้งไว้ (ใช้สร้าง Server และจัดการ Route)
const express = require('express');
const app = express();
const PORT = 3000;

// เรียกใช้ตัวเชื่อมต่อ Supabase ที่สร้างไว้ในไฟล์ supabaseClient.js
const supabase = require('./supabaseClient');

// เรียกใช้ bcrypt สำหรับตรวจสอบรหัสผ่าน
const bcrypt = require('bcrypt');
// เก็บข้อมูล login ไว้ในคุกกี้ (ใช้ได้บน Vercel ที่ server ไม่ได้เปิดค้างตลอด)
const cookieSession = require('cookie-session');

// บอกให้ express เปิดให้เข้าถึงไฟล์ในโฟลเดอร์ public ได้โดยตรง
app.use(express.static('public'));

// จำเป็นต้องมีบรรทัดนี้ เพื่อให้ express อ่านข้อมูล JSON ที่ส่งมาจากฟอร์มได้
app.use(express.json());

// ป้องกันไม่ให้ browser แคช response ของ API ทุกเส้นทาง
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// Vercel ส่ง request ผ่าน proxy ต้องเปิดบรรทัดนี้ ไม่งั้นคุกกี้ secure จะไม่ถูกส่ง
app.set('trust proxy', 1);

app.use(cookieSession({
  name: 'cooltrack_session',
  // กุญแจเซ็นคุกกี้ อ่านจาก Environment Variable (บนเครื่องตัวเองถ้าไม่ได้ตั้ง จะใช้ค่าสำรอง)
  keys: [process.env.SESSION_SECRET || 'ac-maintenance-secret-key'],
  maxAge: 1000 * 60 * 60 * 8,                     // อยู่ได้ 8 ชั่วโมง
  httpOnly: true,                                 // JavaScript ในหน้าเว็บอ่านคุกกี้นี้ไม่ได้
  secure: process.env.NODE_ENV === 'production',  // บน Vercel ส่งผ่าน https เท่านั้น
  sameSite: 'lax'
}));

// [ใหม่] ด่านตรวจ: ทุก API ต้อง login ก่อน ยกเว้นตัว login/logout เอง
// วางไว้ก่อน route ทั้งหมด จะได้คุมทุกตัวในที่เดียว (route ใหม่ในอนาคตก็โดนตรวจอัตโนมัติ)
app.use('/api', (req, res, next) => {
  // req.path ตรงนี้ไม่มีคำว่า /api นำหน้า เช่น /api/login จะเป็น /login
  if (req.path === '/login' || req.path === '/logout') {
    return next();
  }

  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  }

  next();
});

// ==================== API บริษัทลูกค้า ====================

app.get('/api/companies', async (req, res) => {
  const { data, error } = await supabase
    .from('ac_units')
    .select('client_company, status');

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const companyMap = {};
  data.forEach(unit => {
    const name = unit.client_company;
    if (!companyMap[name]) {
      // แยกนับ 2 หมวดแทนที่จะรวมกันเป็นตัวเดียว
      companyMap[name] = { client_company: name, total: 0, needRepairCount: 0, needReplaceCount: 0 };
    }
    companyMap[name].total++;
    if (unit.status === 'ต้องซ่อม') {
      companyMap[name].needRepairCount++;
    } else if (unit.status === 'รอเปลี่ยน') {
      companyMap[name].needReplaceCount++;
    }
  });

  const companies = Object.values(companyMap);
  res.json(companies);
});

// ดึงเครื่องแอร์ทั้งหมดที่ต้องซ่อมหรือรอเปลี่ยน (ข้ามทุกบริษัท) สำหรับหน้าช่าง
app.get('/api/ac-units/need-attention', async (req, res) => {
  const { data, error } = await supabase
    .from('ac_units')
    .select('*')
    .in('status', ['ต้องซ่อม', 'รอเปลี่ยน'])
    .order('status', { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// ==================== API เครื่องแอร์ (ac_units) ====================

app.get('/api/ac-units/company/:company', async (req, res) => {
  const { company } = req.params;
  const companyName = decodeURIComponent(company);

  const { data, error } = await supabase
    .from('ac_units')
    .select('*')
    .eq('client_company', companyName)
    .order('code', { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// ดึงข้อมูลเครื่องแอร์ 1 เครื่องตาม id (ใช้ในหน้าประวัติซ่อม เพื่อโชว์ชื่อบริษัท/ตำแหน่ง)
// ต้องวางไว้หลัง /api/ac-units/need-attention เสมอ ไม่งั้น express จะเข้าใจว่า "need-attention" คือ id
app.get('/api/ac-units/:id', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  }

  const { id } = req.params;

  const { data, error } = await supabase
    .from('ac_units')
    .select('id, code, client_company, location')
    .eq('id', id)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'ไม่พบเครื่องแอร์นี้' });
  }
  res.json(data);
});

app.post('/api/ac-units', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่ทำรายการนี้ได้' });
  }

  const newUnit = req.body;

  const { data, error } = await supabase
    .from('ac_units')
    .insert([newUnit])
    .select();

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

app.put('/api/ac-units/:id', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่ทำรายการนี้ได้' });
  }

  const { id } = req.params;
  const updatedData = req.body;

  const { data, error } = await supabase
    .from('ac_units')
    .update(updatedData)
    .eq('id', id)
    .select();

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

app.delete('/api/ac-units/:id', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่ทำรายการนี้ได้' });
  }

  const { id } = req.params;

  const { error } = await supabase
    .from('ac_units')
    .delete()
    .eq('id', id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json({ message: 'ลบข้อมูลสำเร็จ' });
});

// ==================== API ประวัติซ่อมบำรุง (maintenance_records) ====================

app.get('/api/maintenance/:acUnitId', async (req, res) => {
  const { acUnitId } = req.params;

  // ดึงข้อมูลประวัติซ่อม พร้อม join ชื่อช่าง และอุปกรณ์ที่ใช้ในงานนั้น
  const { data, error } = await supabase
    .from('maintenance_records')
    .select('*, profiles(full_name), repair_items(description, quantity)')
    .eq('ac_unit_id', acUnitId)
    .order('maintenance_date', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// ดึงประวัติการซ่อมทั้งหมด (ข้ามทุกบริษัท) สำหรับ Admin ดูภาพรวมล่าสุด
// ถ้าส่ง ?company=ชื่อบริษัท มา จะกรองเหลือเฉพาะบริษัทนั้น
app.get('/api/maintenance-feed', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่เข้าถึงได้' });
  }

  const { company } = req.query;

  let query = supabase
    .from('maintenance_records')
    // ac_units!inner เพื่อให้กรองด้วยคอลัมน์ของ ac_units ได้
    .select('*, ac_units!inner(code, client_company), profiles(full_name)')
    // เรียงตามวันที่ซ่อมก่อน (ใหม่ → เก่า) วันเดียวกันค่อยเรียงตามเวลาที่บันทึก
    .order('maintenance_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50);

  if (company) {
    query = query.eq('ac_units.client_company', company);
  }

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// บันทึกงานซ่อมใหม่ (แอดมินหรือช่าง) พร้อมอุปกรณ์ที่ใช้ (ถ้ามี)
app.post('/api/maintenance', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  }

  // แยกรายการอุปกรณ์ออกมาก่อน เพราะไม่ใช่คอลัมน์ของตาราง maintenance_records
  const { parts, ...newRecord } = req.body;

  // ถ้าเลือกช่างมาจากฟอร์ม ใช้ค่านั้น ถ้าไม่ได้เลือก ใช้คนที่ login อยู่แทน
  if (!newRecord.technician) {
    newRecord.technician = req.session.user.id;
  }

  const { data, error } = await supabase
    .from('maintenance_records')
    .insert([newRecord])
    .select();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // บันทึกอุปกรณ์ที่ช่างใช้ (ถ้ามี) ราคาเป็น 0 ไว้ก่อน แอดมินเติมตอนออกใบ
  const cleanParts = (Array.isArray(parts) ? parts : [])
    .map(p => ({
      maintenance_record_id: data[0].id,
      description: String(p.description || '').trim(),
      quantity: Number(p.quantity),
      unit_price: 0
    }))
    .filter(p => p.description && p.quantity > 0);

  if (cleanParts.length > 0) {
    const { error: partsError } = await supabase.from('repair_items').insert(cleanParts);
    if (partsError) {
      return res.status(500).json({ error: 'บันทึกงานแล้ว แต่บันทึกอุปกรณ์ไม่สำเร็จ: ' + partsError.message });
    }
  }

  res.json(data);
});

app.delete('/api/maintenance/:id', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่ลบรายการนี้ได้' });
  }

  const { id } = req.params;

  const { error } = await supabase
    .from('maintenance_records')
    .delete()
    .eq('id', id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json({ message: 'ลบข้อมูลสำเร็จ' });
});

// ==================== API รายชื่อช่าง ====================

// ดึงรายชื่อช่างทั้งหมด (สำหรับ Dropdown เลือกตอนบันทึกงานซ่อม)
app.get('/api/technicians', async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'technician');

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// ==================== API แผนตรวจเช็คแอร์ ====================

// ดึงแผนตรวจเช็คทั้งหมด เรียงจากวันที่ใกล้ที่สุดก่อน
app.get('/api/schedules', async (req, res) => {
  const { data, error } = await supabase
    .from('schedules')
    .select('*')
    .order('scheduled_date', { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// เพิ่มแผนตรวจเช็คใหม่ (เฉพาะ admin)
app.post('/api/schedules', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่ทำรายการนี้ได้' });
  }

  const newSchedule = req.body;

  const { data, error } = await supabase
    .from('schedules')
    .insert([newSchedule])
    .select();

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// ลบแผนตรวจเช็ค (เฉพาะ admin) ใช้ตอนตรวจเสร็จแล้วหรือยกเลิกแผน
app.delete('/api/schedules/:id', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่ลบรายการนี้ได้' });
  }

  const { id } = req.params;

  const { error } = await supabase
    .from('schedules')
    .delete()
    .eq('id', id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json({ message: 'ลบข้อมูลสำเร็จ' });
});

// ==================== API รายการราคามาตรฐาน ====================

// ตรวจข้อมูลรายการราคาที่ส่งมา (ใช้ทั้งตอนเพิ่มและแก้ไข)
function checkPriceItem(body) {
  const name = String(body.name || '').trim();
  const price = Number(body.price);
  const itemType = body.item_type === 'labor' ? 'labor' : 'part';
  const unit = String(body.unit || '').trim() || 'ชิ้น';

  if (!name) return { error: 'กรุณากรอกชื่อรายการ' };
  if (!(price >= 0)) return { error: 'ราคาต้องเป็นตัวเลข 0 ขึ้นไป' };

  return { row: { name, item_type: itemType, unit, price } };
}

// ดึงรายการราคาทั้งหมด (ทั้งแอดมินและช่างใช้ได้ ช่างใช้เลือกชื่ออุปกรณ์)
app.get('/api/price-list', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  }

  const { data, error } = await supabase
    .from('price_list')
    .select('*')
    .order('item_type', { ascending: true }) // labor ขึ้นก่อน part
    .order('name', { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// เพิ่มรายการราคา (เฉพาะแอดมิน)
app.post('/api/price-list', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่ทำรายการนี้ได้' });
  }

  const checked = checkPriceItem(req.body);
  if (checked.error) {
    return res.status(400).json({ error: checked.error });
  }

  const { data, error } = await supabase
    .from('price_list')
    .insert([checked.row])
    .select()
    .single();

  if (error) {
    // 23505 = ชื่อซ้ำ (ตั้ง UNIQUE ไว้ในตาราง)
    const message = error.code === '23505' ? 'มีรายการชื่อนี้อยู่แล้ว' : error.message;
    return res.status(400).json({ error: message });
  }
  res.json(data);
});

// แก้ไขรายการราคา (เฉพาะแอดมิน) ไม่กระทบใบที่ออกไปแล้ว เพราะใบเก็บราคาไว้ในตัวเอง
app.put('/api/price-list/:id', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่ทำรายการนี้ได้' });
  }

  const checked = checkPriceItem(req.body);
  if (checked.error) {
    return res.status(400).json({ error: checked.error });
  }

  const { data, error } = await supabase
    .from('price_list')
    .update(checked.row)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) {
    const message = error.code === '23505' ? 'มีรายการชื่อนี้อยู่แล้ว' : error.message;
    return res.status(400).json({ error: message });
  }
  res.json(data);
});

// ลบรายการราคา (เฉพาะแอดมิน)
app.delete('/api/price-list/:id', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่ลบรายการนี้ได้' });
  }

  const { error } = await supabase
    .from('price_list')
    .delete()
    .eq('id', req.params.id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json({ message: 'ลบรายการแล้ว' });
});

// ==================== API รายงาน / ใบเรียกเก็บเงิน ====================

// ข้อมูลที่ต้อง join มาใช้ในรายงาน (ใช้ร่วมกันหลาย route)
const REPORT_SELECT = `
  *,
  ac_units!inner(code, client_company, location, brand, btu_size),
  profiles(full_name),
  repair_items(*),
  invoices(id, invoice_no)
`;

// ปัดทศนิยม 2 ตำแหน่ง (ใช้กับเงิน)
function round2(n) {
  return Math.round(n * 100) / 100;
}

// ตรวจรายการราคาที่ส่งมาจากหน้าเว็บ (ใช้ทั้งตอนออกใบและตอนแก้ไขใบ)
// recordIds = id งานซ่อมที่อนุญาตให้ใส่ราคาได้
// คืนค่า { error } ถ้าผิด หรือ { cleanItems, subtotal, vat, total } ถ้าถูก
function checkItems(items, recordIds) {
  const allowed = recordIds.map(String); // เทียบเป็นข้อความ เพราะหน้าเว็บอาจส่ง id มาเป็น string
  const cleanItems = [];

  for (const item of items) {
    const description = String(item.description || '').trim();
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unit_price);

    if (!allowed.includes(String(item.maintenance_record_id))) {
      return { error: 'มีรายการที่ไม่ใช่งานในใบนี้' };
    }
    if (!description || !(quantity > 0) || !(unitPrice >= 0)) {
      return { error: 'กรอกชื่อรายการ จำนวน และราคาให้ถูกต้อง' };
    }
    cleanItems.push({
      maintenance_record_id: item.maintenance_record_id,
      description,
      quantity,
      unit_price: unitPrice
    });
  }

  if (cleanItems.length === 0) {
    return { error: 'กรุณาเพิ่มรายการค่าใช้จ่ายอย่างน้อย 1 รายการ' };
  }

  // คำนวณยอดเงินที่ server เอง ไม่เชื่อตัวเลขจากหน้าเว็บ
  const subtotal = round2(cleanItems.reduce((sum, i) => sum + i.quantity * i.unit_price, 0));
  const vat = round2(subtotal * 0.07);
  return { cleanItems, subtotal, vat, total: round2(subtotal + vat) };
}

// สร้างเลขที่ใบถัดไป เช่น INV-202609-0003
// ดูจากเลขที่มากที่สุดของเดือนนี้ +1 (ไม่ใช้การนับจำนวน เพราะถ้ามีใบถูกยกเลิก เลขจะชนกัน)
async function nextInvoiceNo() {
  const now = new Date();
  const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`;

  const { data } = await supabase
    .from('invoices')
    .select('invoice_no')
    .like('invoice_no', prefix + '%')
    .order('invoice_no', { ascending: false })
    .limit(1);

  const lastNumber = data && data.length > 0 ? parseInt(data[0].invoice_no.slice(prefix.length), 10) : 0;
  return prefix + String(lastNumber + 1).padStart(4, '0');
}

// ดึงงานซ่อม "ที่เสร็จสิ้นแล้ว" ของบริษัทหนึ่งในวันหนึ่ง สำหรับทำใบสรุปงาน/ใบเรียกเก็บเงิน
// เรียกแบบ /api/report?company=ชื่อบริษัท&date=2026-09-23
app.get('/api/report', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่เข้าถึงได้' });
  }

  const { company, date } = req.query;
  if (!company || !date) {
    return res.status(400).json({ error: 'กรุณาเลือกบริษัทและวันที่' });
  }

  const { data, error } = await supabase
    .from('maintenance_records')
    .select(REPORT_SELECT)
    .eq('ac_units.client_company', company)
    .eq('maintenance_date', date)
    .eq('status', 'เสร็จสิ้น') // เอาเฉพาะงานที่ซ่อมเสร็จแล้ว
    .order('created_at', { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// ดึงรายการใบเรียกเก็บเงินทั้งหมด (ใช้ในหน้า invoices.html)
// กรองตามบริษัทได้: /api/invoices?company=ชื่อบริษัท
app.get('/api/invoices', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่เข้าถึงได้' });
  }

  const { company } = req.query;

  let query = supabase
    .from('invoices')
    .select('*')
    .order('created_at', { ascending: false }); // ใบล่าสุดขึ้นก่อน

  if (company) query = query.eq('client_company', company);

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// ดึงใบเรียกเก็บเงิน 1 ใบ พร้อมงานซ่อมและรายการราคาในใบนั้น
app.get('/api/invoices/:id', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่เข้าถึงได้' });
  }

  const { id } = req.params;

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !invoice) {
    return res.status(404).json({ error: 'ไม่พบใบเรียกเก็บเงินนี้' });
  }

  const { data: records, error: recError } = await supabase
    .from('maintenance_records')
    .select(REPORT_SELECT)
    .eq('invoice_id', id)
    .order('created_at', { ascending: true });

  if (recError) {
    return res.status(500).json({ error: recError.message });
  }
  res.json({ invoice, records });
});

// ออกใบเรียกเก็บเงินใหม่ จากงานที่เสร็จสิ้นของบริษัท/วันนั้นที่ยังไม่เคยออกใบ
// body: { company, date, items: [{ maintenance_record_id, description, quantity, unit_price }] }
app.post('/api/invoices', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่ทำรายการนี้ได้' });
  }

  const { company, date, items } = req.body;
  if (!company || !date || !Array.isArray(items)) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
  }

  // 1) หางานที่เสร็จสิ้นแล้วของบริษัท/วันนั้น ที่ยังไม่ได้ออกใบ
  const { data: records, error: recError } = await supabase
    .from('maintenance_records')
    .select('id, ac_units!inner(client_company)')
    .eq('ac_units.client_company', company)
    .eq('maintenance_date', date)
    .eq('status', 'เสร็จสิ้น')
    .is('invoice_id', null);

  if (recError) {
    return res.status(500).json({ error: recError.message });
  }
  if (records.length === 0) {
    return res.status(400).json({ error: 'ไม่มีงานที่เสร็จสิ้นและยังไม่ออกใบในวันนี้' });
  }
  const recordIds = records.map(r => r.id);

  // 2) ตรวจรายการ + คำนวณยอด
  const checked = checkItems(items, recordIds);
  if (checked.error) {
    return res.status(400).json({ error: checked.error });
  }

  // 3) บันทึกใบ พร้อมเลขที่ใหม่
  const invoiceNo = await nextInvoiceNo();
  const { data: invoice, error: invError } = await supabase
    .from('invoices')
    .insert([{
      invoice_no: invoiceNo,
      client_company: company,
      service_date: date,
      subtotal: checked.subtotal,
      vat: checked.vat,
      total: checked.total
    }])
    .select()
    .single();

  if (invError) {
    return res.status(500).json({ error: invError.message });
  }

  // 4) บันทึกรายการราคา (ลบของเก่าที่อาจค้างอยู่ก่อน)
  await supabase.from('repair_items').delete().in('maintenance_record_id', recordIds);
  const { error: itemError } = await supabase.from('repair_items').insert(checked.cleanItems);

  if (itemError) {
    await supabase.from('invoices').delete().eq('id', invoice.id); // ไม่ให้มีใบเปล่าค้าง
    return res.status(500).json({ error: itemError.message });
  }

  // 5) ผูกงานซ่อมเข้ากับใบนี้ (กันออกใบซ้ำ)
  const { error: linkError } = await supabase
    .from('maintenance_records')
    .update({ invoice_id: invoice.id })
    .in('id', recordIds);

  if (linkError) {
    await supabase.from('repair_items').delete().in('maintenance_record_id', recordIds);
    await supabase.from('invoices').delete().eq('id', invoice.id);
    return res.status(500).json({ error: linkError.message });
  }

  res.json(invoice);
});

// แก้ไขรายการราคาในใบที่ออกไปแล้ว (เลขที่ใบคงเดิม)
// body: { items: [{ maintenance_record_id, description, quantity, unit_price }] }
app.put('/api/invoices/:id', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่ทำรายการนี้ได้' });
  }

  const { id } = req.params;
  const { items } = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
  }

  // 1) หางานซ่อมที่อยู่ในใบนี้
  const { data: records, error: recError } = await supabase
    .from('maintenance_records')
    .select('id')
    .eq('invoice_id', id);

  if (recError) {
    return res.status(500).json({ error: recError.message });
  }
  if (records.length === 0) {
    return res.status(404).json({ error: 'ไม่พบใบเรียกเก็บเงินนี้' });
  }
  const recordIds = records.map(r => r.id);

  // 2) ตรวจรายการ + คำนวณยอดใหม่
  const checked = checkItems(items, recordIds);
  if (checked.error) {
    return res.status(400).json({ error: checked.error });
  }

  // 3) ลบรายการเก่าของใบนี้ แล้วใส่รายการใหม่แทน
  const { error: delError } = await supabase
    .from('repair_items')
    .delete()
    .in('maintenance_record_id', recordIds);

  if (delError) {
    return res.status(500).json({ error: delError.message });
  }

  const { error: itemError } = await supabase.from('repair_items').insert(checked.cleanItems);
  if (itemError) {
    return res.status(500).json({ error: itemError.message });
  }

  // 4) อัปเดตยอดเงินในใบ
  const { data: invoice, error: invError } = await supabase
    .from('invoices')
    .update({ subtotal: checked.subtotal, vat: checked.vat, total: checked.total })
    .eq('id', id)
    .select()
    .single();

  if (invError) {
    return res.status(500).json({ error: invError.message });
  }
  res.json(invoice);
});

// ยกเลิกใบ: ลบใบทิ้ง และปล่อยงานซ่อมในใบให้กลับไปออกใบใหม่ได้
app.delete('/api/invoices/:id', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่ทำรายการนี้ได้' });
  }

  const { id } = req.params;

  // 1) หางานซ่อมที่อยู่ในใบนี้
  const { data: records, error: recError } = await supabase
    .from('maintenance_records')
    .select('id')
    .eq('invoice_id', id);

  if (recError) {
    return res.status(500).json({ error: recError.message });
  }
  const recordIds = records.map(r => r.id);

  // 2) ปลดงานซ่อมออกจากใบก่อน (ต้องทำก่อนลบใบ ไม่งั้นลบไม่ได้เพราะยังมีงานอ้างถึงใบนี้อยู่)
  const { error: unlinkError } = await supabase
    .from('maintenance_records')
    .update({ invoice_id: null })
    .eq('invoice_id', id);

  if (unlinkError) {
    return res.status(500).json({ error: unlinkError.message });
  }

  // 3) ลบรายการราคาของงานเหล่านั้น
  if (recordIds.length > 0) {
    await supabase.from('repair_items').delete().in('maintenance_record_id', recordIds);
  }

  // 4) ลบตัวใบ
  const { error: delError } = await supabase.from('invoices').delete().eq('id', id);
  if (delError) {
    return res.status(500).json({ error: delError.message });
  }

  res.json({ message: 'ยกเลิกใบเรียกเก็บเงินแล้ว' });
});

// ==================== API ระบบ Login ====================

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  const { data: user, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', username)
    .single();

  if (error || !user) {
    return res.status(401).json({ error: 'Username หรือ Password ไม่ถูกต้อง' });
  }

  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    return res.status(401).json({ error: 'Username หรือ Password ไม่ถูกต้อง' });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role
  };

  res.json({ message: 'Login สำเร็จ', user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  // cookie-session ไม่มี destroy() ใช้วิธีล้างค่าเป็น null แทน
  req.session = null;
  res.json({ message: 'Logout สำเร็จ' });
});

app.get('/api/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'ยังไม่ได้ login' });
  }
  res.json(req.session.user);
});

// ==================== เริ่มรัน Server ====================

app.listen(PORT, () => {
  // มีคำว่า v5 ไว้เช็คว่ากำลังรันไฟล์เวอร์ชันล่าสุดจริง
  console.log(`Server กำลังทำงานที่ http://localhost:${PORT} (v5 ด่านตรวจ login)`);
});