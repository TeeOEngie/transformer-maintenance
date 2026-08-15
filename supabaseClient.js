// เรียกใช้ dotenv เพื่ออ่านค่าจากไฟล์ .env เข้ามาใช้ในโปรเจค
require('dotenv').config();

// เรียกใช้ library สำหรับสร้างการเชื่อมต่อกับ Supabase
const { createClient } = require('@supabase/supabase-js');

// ดึงค่า URL และ Key ที่เก็บไว้ในไฟล์ .env มาเก็บในตัวแปร
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// สร้าง client เชื่อมต่อ Supabase โดยใช้ URL และ Key ที่ดึงมา
const supabase = createClient(supabaseUrl, supabaseKey);

// ส่งออกตัวแปร supabase ให้ไฟล์อื่น (เช่น server.js) เรียกใช้งานได้
module.exports = supabase;