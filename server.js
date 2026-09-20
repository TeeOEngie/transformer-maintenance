// เรียกใช้ library express ที่ติดตั้งไว้ (ใช้สร้าง Server และจัดการ Route)
const express = require('express');
const app = express();
const PORT = 3000;

// เรียกใช้ตัวเชื่อมต่อ Supabase ที่สร้างไว้ในไฟล์ supabaseClient.js
const supabase = require('./supabaseClient');

// เรียกใช้ bcrypt สำหรับตรวจสอบรหัสผ่าน
const bcrypt = require('bcrypt');
// เรียกใช้ express-session สำหรับจดจำสถานะว่า login แล้ว
const session = require('express-session');

// บอกให้ express เปิดให้เข้าถึงไฟล์ในโฟลเดอร์ public ได้โดยตรง
app.use(express.static('public'));

// จำเป็นต้องมีบรรทัดนี้ เพื่อให้ express อ่านข้อมูล JSON ที่ส่งมาจากฟอร์มได้
app.use(express.json());

// ตั้งค่า session ให้ express ใช้งาน
app.use(session({
  secret: 'ac-maintenance-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

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

  // ดึงข้อมูลประวัติซ่อม พร้อม join เอาชื่อช่างจากตาราง profiles มาด้วย
  const { data, error } = await supabase
    .from('maintenance_records')
    .select('*, profiles(full_name)')
    .eq('ac_unit_id', acUnitId)
    .order('maintenance_date', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

app.get('/api/maintenance/:acUnitId', async (req, res) => {
  const { acUnitId } = req.params;

  const { data, error } = await supabase
    .from('maintenance_records')
    .select('*, profiles(full_name)')
    .eq('ac_unit_id', acUnitId)
    .order('maintenance_date', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// ===== วางโค้ดใหม่ตรงนี้ =====
// ดึงประวัติการซ่อมทั้งหมด (ข้ามทุกบริษัท) สำหรับ Admin ดูภาพรวมล่าสุด
app.get('/api/maintenance-feed', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่เข้าถึงได้' });
  }

  const { data, error } = await supabase
    .from('maintenance_records')
    .select('*, ac_units(code, client_company), profiles(full_name)')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

app.post('/api/maintenance', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  }

  const newRecord = req.body;

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
  req.session.destroy(() => {
    res.json({ message: 'Logout สำเร็จ' });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'ยังไม่ได้ login' });
  }
  res.json(req.session.user);
});

// ==================== เริ่มรัน Server ====================

app.listen(PORT, () => {
  console.log(`Server กำลังทำงานที่ http://localhost:${PORT}`);
});