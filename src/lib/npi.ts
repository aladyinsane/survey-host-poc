// NPI: 10 digits, the last a Luhn check digit computed over the prefix 80840 plus the first nine.
// Catches typos, not made-up numbers. Shared by the server and the start form.
export function isValidNpi(value: string): boolean {
  if (!/^[0-9]{10}$/.test(value)) return false;
  const digits = `80840${value}`;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
