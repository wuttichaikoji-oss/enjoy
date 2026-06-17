# สิทธิ์-ปิ่น น้ำยางสด Version 3

เว็บแอพคำนวณบิลรับซื้อยาง / ขี้ยาง / ยางก้อนถ้วย พร้อมขายต่อโรงงาน สต๊อก รายงานกำไร และ Cloud Sync ผ่าน Firebase/Firestore

อัปเดตนี้ใส่โลโก้ **สิทธิ์-ปิ่น น้ำยางสด** ในหน้าเว็บ, PWA icon, favicon และหัวบิลพิมพ์แล้ว
- ใบพิมพ์บิล thermal ใช้โลโก้ขาวดำ `assets/logo-thermal.png` โดยอัตโนมัติ ส่วนหน้าเว็บยังใช้โลโก้สี `assets/logo.png`



## อัปเดตเวอร์ชันมือถือ

- เพิ่มเมนูมือถือด้านล่าง รองรับ iPhone/Android พร้อม safe-area สำหรับจอมีรอยบาก
- ปรับฟอร์มให้กรอกง่าย ปุ่มใหญ่ แตะง่าย และไม่ซูมเองบน iPhone
- ปรับ Dashboard/Card ให้พอดีกับจอเล็ก
- แปลงตารางเป็นการ์ดบนมือถือ เพื่ออ่านบิล รายงาน สต๊อก รายชื่อ ได้ง่ายขึ้น
- ปรับ Modal/Popup เป็น bottom sheet บนมือถือ
- อัปเดต service worker cache เป็นเวอร์ชันมือถือ เพื่อบังคับโหลดไฟล์ใหม่

## สิ่งที่มีใน V3

- ไม่มีหน้า Login
- รับซื้อน้ำยางสดแบบ DRC
- รับซื้อขี้ยาง / ยางก้อนถ้วย 2 แบบ: คิดตามกิโลกรัม และคิดแบบ DRC
- หักถัง / หักค่ารถ / หักหนี้ / หักอื่น ๆ
- บันทึกบิลซื้อ
- ขายต่อโรงงาน
- เพิ่มรายชื่อชาวสวนและโรงงาน
- ระบบสต๊อก ซื้อเข้า / ขายออก / ปรับสต๊อก
- รายงานซื้อ / ขาย / กำไร / ค้างจ่าย / ค้างรับ
- พิมพ์บิล 58mm / 80mm / A4
- แนบรูปหลักฐาน เช่น รูปตาชั่งหรือสลิป
- Export CSV สำหรับเปิดใน Excel
- Export / Import JSON สำหรับสำรองข้อมูล
- PWA เบื้องต้น เปิดใช้งานแบบแอพได้
- Cloud Sync Firebase/Firestore สำหรับหลายเครื่อง

## วิธีเปิดใช้แบบ Local

1. แตก ZIP
2. เปิดไฟล์ `index.html`
3. ใช้งานได้ทันที ข้อมูลจะอยู่ในเครื่อง/เบราว์เซอร์นั้น

## วิธีอัปขึ้น GitHub Pages

1. แตก ZIP
2. อัปโหลดไฟล์ทั้งหมดขึ้น repository
3. เปิด Settings > Pages
4. เลือก branch และ folder ที่เก็บไฟล์
5. เปิดลิงก์ GitHub Pages ที่ได้

## วิธีเปิด Cloud Sync Firebase

Firebase config ของโปรเจกต์ `enjoy-5eff3` ถูกใส่ไว้ในแอพแล้ว

1. เปิด Authentication > Sign-in method > Anonymous > Enable
2. เปิด Firestore Database
3. ใส่ Firestore Rules จากไฟล์ `firestore.rules`
4. เปิดเว็บแอพ > ตั้งค่า > Cloud Sync Firebase
5. ใช้ Shop Code `sitpin-main` เพื่อให้ทุกเครื่องซิงก์ข้อมูลชุดเดียวกัน
6. กด `บันทึก + เชื่อม Firebase` หรือรอให้ระบบเชื่อมอัตโนมัติเมื่อเปิดแอพครั้งแรก

> ใช้ Shop Code เดียวกันทุกเครื่อง เพื่อให้ข้อมูลซิงก์ชุดเดียวกัน

## Firestore data path

ข้อมูลจะถูกเก็บที่:

```text
rubberSitpin/{shopCode}/customers
rubberSitpin/{shopCode}/factories
rubberSitpin/{shopCode}/prices
rubberSitpin/{shopCode}/purchases
rubberSitpin/{shopCode}/sales
rubberSitpin/{shopCode}/stockAdjustments
rubberSitpin/{shopCode}/meta/settings
```

## หมายเหตุเรื่องความปลอดภัย

เวอร์ชันนี้ออกแบบตามคำขอให้ไม่มีหน้า Login แต่ใช้ Anonymous Authentication หลังบ้านเพื่อให้ Firestore Rules ตรวจได้ว่าเป็นผู้ใช้ที่ authenticated แล้ว

Rules ที่ให้มาเหมาะกับการเริ่มทดสอบและใช้งานภายในร้าน หากต้องการความปลอดภัยระดับ production ควรเพิ่มระบบสิทธิ์ผู้ใช้ / Admin / Staff ในเวอร์ชันถัดไป

## ข้อควรระวัง

- ถ้าแนบรูปจำนวนมาก ฐานข้อมูลจะโตเร็ว ควร Export JSON สำรองเป็นระยะ
- ถ้าใช้ Cloud Sync ต้องเปิดอินเทอร์เน็ต
- ถ้า Firebase ยังไม่ได้ตั้งค่า ระบบยังใช้ Local ได้ตามปกติ

- ปรับโลโก้ในแอพให้เป็นเวอร์ชันขาวดำตามแบบล่าสุด ทั้งหน้าเว็บ, ไอคอนแอพ และใบบิล thermal
