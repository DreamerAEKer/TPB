import { calculateCheckDigit } from './src/tracking.js';

function test() {
  const testCases = [
    { digits: "12345678", expected: 5 },
    { digits: "00000000", expected: 5 },
    { digits: "11111111", expected: 5 },
    { digits: "00000001", expected: 4 }
  ];

  testCases.forEach(tc => {
    const result = calculateCheckDigit(tc.digits);
    if (result === tc.expected) {
      console.log(`PASS: ${tc.digits} => ${result}`);
    } else {
      console.error(`FAIL: ${tc.digits} => expected ${tc.expected}, got ${result}`);
    }
  });
}

test();
