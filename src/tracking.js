/**
 * คำนวณ Check Digit สำหรับเลข Tracking ไปรษณีย์ไทย 13 หลัก
 * @param {string} digits เลข 8 หลัก (สายอักขระ)
 * @returns {number} Check Digit (0-9)
 */
export function calculateCheckDigit(digits) {
  if (digits.length !== 8) throw new Error("ต้องมีตัวเลข 8 หลัก");
  
  const weights = [8, 6, 4, 2, 3, 5, 9, 7];
  let sum = 0;
  
  for (let i = 0; i < 8; i++) {
    sum += parseInt(digits[i]) * weights[i];
  }
  
  const remainder = sum % 11;
  let checkDigit;
  
  if (remainder === 0) {
    checkDigit = 5;
  } else if (remainder === 1) {
    checkDigit = 0;
  } else {
    checkDigit = 11 - remainder;
  }
  
  return checkDigit;
}

/**
 * รูปแบบเลข Tracking: "XX 0000 0000 0 TH"
 * @param {string} prefix สองหลักข้างหน้า
 * @param {string} digits แปดหลักกลาง
 * @param {number} checkDigit พ่วงท้ายตัวเลข
 * @returns {string} ข้อความเลข Tracking ที่จัดรูปแบบแล้ว
 */
export function formatTrackingNumber(prefix, digits, checkDigit) {
  const allDigits = digits + checkDigit.toString();
  // "XX 0000 0000 0 TH"
  // XX = prefix
  // 0000 = allDigits[0-3]
  // 0000 = allDigits[4-7]
  // 0 = allDigits[8]
  return `${prefix.toUpperCase()} ${allDigits.substring(0, 4)} ${allDigits.substring(4, 8)} ${allDigits.substring(8, 9)} TH`;
}
