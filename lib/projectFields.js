// Choices for the "Headed By" field on a project
export const HEADED_BY_OPTIONS = ['JOYSON', 'GIREESH', 'None'];

// Choices for the "Sales Person" field on a project (in this order)
export const SALES_PEOPLE = [
  'AKSHAY', 'ALWIN', 'ANJO', 'BIJU', 'GEORGE', 'HARRIS',
  'INDRAJITH', 'RAJATH', 'SHARATH', 'SIDHARTH', 'SINEESH',
];

// The list, plus a value saved before the list existed (so it isn't lost when editing)
export function salesPeopleWith(current) {
  const v = (current || '').trim();
  return v && !SALES_PEOPLE.includes(v.toUpperCase()) && !SALES_PEOPLE.includes(v) ? [...SALES_PEOPLE, v] : SALES_PEOPLE;
}
