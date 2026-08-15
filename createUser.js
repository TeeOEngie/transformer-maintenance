// เรียกใช้ bcrypt สำหรับเข้ารหัสรหัสผ่าน
const bcrypt = require('bcrypt');
// เรียกใช้ตัวเชื่อมต่อ Supabase
const supabase = require('./supabaseClient');

// ฟังก์ชันสร้างผู้ใช้ใหม่ รับค่า username, password ตัวจริง, ชื่อเต็ม, และ role
async function createUser(username, plainPassword, fullName, role) {
  // เข้ารหัสรหัสผ่านก่อนเก็บลงฐานข้อมูล (saltRounds = 10 เป็นค่ามาตรฐาน)
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  // บันทึกข้อมูลผู้ใช้ใหม่ลงตาราง profiles
  const { data, error } = await supabase
    .from('profiles')
    .insert([{
      username: username,
      password: hashedPassword, // เก็บรหัสผ่านที่เข้ารหัสแล้ว ไม่ใช่ตัวจริง
      full_name: fullName,
      role: role
    }])
    .select();

  if (error) {
    console.log('เกิดข้อผิดพลาด:', error.message);
    return;
  }

  console.log('สร้างผู้ใช้สำเร็จ:', data);
}

// เรียกใช้ฟังก์ชันเพื่อสร้าง Admin คนแรก
// แก้ไข username, password, ชื่อ ตามที่ต้องการได้เลย
createUser('chang01', 'password123', 'สมชาย ใจดี', 'technician');
createUser('admin01', 'password123', 'ผู้ดูแลระบบ', 'admin');