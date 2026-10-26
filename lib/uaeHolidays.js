// UAE public holidays shown on the Calendar.
// Islamic holidays follow the moon, so their dates are the expected
// ones and can move by a day once the UAE Cabinet announces them.
// Once a year: add the next year's dates (and fix any that moved).
//   moon: true = date depends on moon sighting (shown as "expected")

const HOLIDAYS = [
  // ---------- 2026 ----------
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-03-20', name: 'Eid al-Fitr', moon: true },
  { date: '2026-03-21', name: 'Eid al-Fitr', moon: true },
  { date: '2026-03-22', name: 'Eid al-Fitr', moon: true },
  { date: '2026-05-26', name: 'Arafat Day', moon: true },
  { date: '2026-05-27', name: 'Eid al-Adha', moon: true },
  { date: '2026-05-28', name: 'Eid al-Adha', moon: true },
  { date: '2026-05-29', name: 'Eid al-Adha', moon: true },
  { date: '2026-06-16', name: 'Islamic New Year', moon: true },
  { date: '2026-08-25', name: "Prophet's Birthday", moon: true },
  { date: '2026-12-02', name: 'UAE National Day' },
  { date: '2026-12-03', name: 'UAE National Day' },

  // ---------- 2027 ----------
  { date: '2027-01-01', name: "New Year's Day" },
  { date: '2027-03-09', name: 'Eid al-Fitr', moon: true },
  { date: '2027-03-10', name: 'Eid al-Fitr', moon: true },
  { date: '2027-03-11', name: 'Eid al-Fitr', moon: true },
  { date: '2027-05-15', name: 'Arafat Day', moon: true },
  { date: '2027-05-16', name: 'Eid al-Adha', moon: true },
  { date: '2027-05-17', name: 'Eid al-Adha', moon: true },
  { date: '2027-05-18', name: 'Eid al-Adha', moon: true },
  { date: '2027-06-06', name: 'Islamic New Year', moon: true },
  { date: '2027-08-14', name: "Prophet's Birthday", moon: true },
  { date: '2027-12-02', name: 'UAE National Day' },
  { date: '2027-12-03', name: 'UAE National Day' },
];

const BY_DATE = new Map(HOLIDAYS.map((h) => [h.date, h]));

// { name, moon } for a "YYYY-MM-DD" day, or null
export function holidayOn(key) {
  return BY_DATE.get(key) || null;
}
