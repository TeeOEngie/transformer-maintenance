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
  secret: 'transformer-maintenance-secret-key', // กุญแจลับใช้เข้ารหัส session
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // session อยู่ได้ 8 ชั่วโมง
}));

// ==================== API หม้อแปลง (transformers) ====================

// ดึงข้อมูลหม้อแปลงทั้งหมด
app.get('/api/transformers', async (req, res) => {
  const { data, error } = await supabase
    .from('transformers')
    .select('*')
    .order('code', { ascending: true })

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// เพิ่มหม้อแปลงใหม่ (Create)
app.post('/api/transformers', async (req, res) => {
  const newTransformer = req.body;

  const { data, error } = await supabase
    .from('transformers')
    .insert([newTransformer])
    .select();

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// แก้ไขข้อมูลหม้อแปลง (Update)
app.put('/api/transformers/:id', async (req, res) => {
  const { id } = req.params;
  const updatedData = req.body;

  const { data, error } = await supabase
    .from('transformers')
    .update(updatedData)
    .eq('id', id)
    .select();

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// ลบข้อมูลหม้อแปลง (Delete)
app.delete('/api/transformers/:id', async (req, res) => {
  // เช็คก่อนว่า login แล้ว และเป็น role admin เท่านั้นถึงจะลบข้อมูลได้
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่ทำรายการนี้ได้' });
  }

  const { id } = req.params;

  const { error } = await supabase
    .from('transformers')
    .delete()
    .eq('id', id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json({ message: 'ลบข้อมูลสำเร็จ' });
});

// ==================== API ประวัติซ่อมบำรุง (maintenance_records) ====================

// ดึงประวัติซ่อมทั้งหมดของหม้อแปลงตัวใดตัวหนึ่ง (ระบุผ่าน transformer_id)
app.get('/api/maintenance/:transformerId', async (req, res) => {
  const { transformerId } = req.params;

  // ดึงข้อมูลจากตาราง maintenance_records เฉพาะของหม้อแปลงตัวนี้
  // เรียงจากวันที่ล่าสุดไปเก่าสุด
  const { data, error } = await supabase
    .from('maintenance_records')
    .select('*')
    .eq('transformer_id', transformerId)
    .order('maintenance_date', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// เพิ่มบันทึกการซ่อมบำรุงใหม่
app.post('/api/maintenance', async (req, res) => {
  // ต้อง Login ก่อนถึงจะบันทึกได้ (เช็คจาก session)
  if (!req.session.user) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  }

  const newRecord = req.body;

  // ใส่ id ของผู้ใช้ที่ login อยู่ตอนนี้ ลงในช่อง technician อัตโนมัติ
  // ไม่ต้องให้ผู้ใช้เลือกเอง ป้องกันการสวมรอยว่าเป็นคนอื่นบันทึก
  newRecord.technician = req.session.user.id;

  const { data, error } = await supabase
    .from('maintenance_records')
    .insert([newRecord])
    .select();

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// ==================== API ระบบ Login ====================

// Login: ตรวจสอบ username/password
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

// Logout: ล้าง session ทิ้ง
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logout สำเร็จ' });
  });
});

// เช็คว่าตอนนี้ login อยู่หรือไม่
app.get('/api/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'ยังไม่ได้ login' });
  }
  res.json(req.session.user);
});

// ==================== API ประวัติซ่อมบำรุง (maintenance_records) ====================

// ดึงประวัติซ่อมทั้งหมดของหม้อแปลงตัวใดตัวหนึ่ง (ระบุผ่าน transformer_id)
app.get('/api/maintenance/:transformerId', async (req, res) => {
  const { transformerId } = req.params;

  const { data, error } = await supabase
    .from('maintenance_records')
    .select('*')
    .eq('transformer_id', transformerId)
    .order('maintenance_date', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// เพิ่มบันทึกการซ่อมบำรุงใหม่
app.post('/api/maintenance', async (req, res) => {
  // ต้อง Login ก่อนถึงจะบันทึกได้ (เช็คจาก session)
  if (!req.session.user) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  }

  const newRecord = req.body;

  // ใส่ id ของผู้ใช้ที่ login อยู่ตอนนี้ ลงในช่อง technician อัตโนมัติ
  newRecord.technician = req.session.user.id;

  const { data, error } = await supabase
    .from('maintenance_records')
    .insert([newRecord])
    .select();

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// ลบประวัติการซ่อมบำรุง (เฉพาะ admin เท่านั้น)
app.delete('/api/maintenance/:id', async (req, res) => {
  // เช็คก่อนว่า login แล้ว และเป็น role admin เท่านั้นถึงจะลบได้
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

// ==================== เริ่มรัน Server ====================

app.listen(PORT, () => {
  console.log(`Server กำลังทำงานที่ http://localhost:${PORT}`);
});