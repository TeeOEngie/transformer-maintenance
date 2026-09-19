// เรียกใช้ bcrypt สำหรับเข้ารหัสรหัสผ่าน
const bcrypt = require('bcrypt');
// เรียกใช้ตัวเชื่อมต่อ Supabase
const supabase = require('./supabaseClient');

// ฟังก์ชันสร้างผู้ใช้ใหม่ 1 คน
async function createUser(username, plainPassword, fullName, role) {
  // เข้ารหัสรหัสผ่านก่อนเก็บลงฐานข้อมูล
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  const { data, error } = await supabase
    .from('profiles')
    .insert([{
      username: username,
      password: hashedPassword,
      full_name: fullName,
      role: role
    }])
    .select();

  if (error) {
    console.log(`เกิดข้อผิดพลาดตอนสร้าง ${username}:`, error.message);
    return;
  }

  console.log(`สร้างสำเร็จ: ${username} (${role})`);
}

// ฟังก์ชันหลัก สร้างผู้ใช้หลายคนพร้อมกันตามลำดับ
async function createAllUsers() {
  // สร้างบัญชี Admin 1 คน
  await createUser('admin01', 'password123', 'ผู้ดูแลระบบ', 'admin');

  // สร้างบัญชีช่าง 2 คน (แก้ไข/เพิ่มได้ตามต้องการ)
  await createUser('chang01', 'password123', 'สมชาย ใจดี', 'technician');
  await createUser('chang02', 'password123', 'สมหญิง รักงาน', 'technician');

  console.log('สร้างบัญชีทั้งหมดเสร็จสิ้น');
}

// เรียกใช้ฟังก์ชันหลัก
createAllUsers();
