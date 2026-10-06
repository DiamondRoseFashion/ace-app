// Builds the data for the Excel backup and the "View Data" page, so the
// two always show exactly the same thing. Server-only (uses the admin
// client passed in).

import { projectStatusLabel } from '@/lib/projectStatus';

// Only the raw database primary/foreign keys get dropped — everything else stays.
const ID_LIKE_KEYS = new Set(['id', 'project_id']);

export const ROLE_ORDER = ['contractor', 'client', 'consultant', 'main_contractor'];
export const ROLE_LABELS = {
  contractor: 'Contractor',
  client: 'Client',
  consultant: 'Consultant',
  main_contractor: 'Main Contractor',
};

// Turns any ISO date/datetime string (e.g. 2026-07-29T05:50:53...) into a
// simple DD/MM/YYYY string. Leaves everything else as-is.
export function formatRowDates(row) {
  const formatted = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        const day = String(d.getUTCDate()).padStart(2, '0');
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const year = d.getUTCFullYear();
        formatted[key] = `${day}/${month}/${year}`;
        continue;
      }
    }
    formatted[key] = value;
  }
  return formatted;
}

// Removes only the raw internal id / project_id columns before export.
export function stripIds(row) {
  const cleaned = {};
  for (const [key, value] of Object.entries(row)) {
    if (ID_LIKE_KEYS.has(key)) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

function clean(v) {
  return typeof v === 'string' ? v.trim() : v;
}

// "Ahmed Ali (Project Manager) · 050 123 4567 · ahmed@co.com"
function contactLine(c) {
  const head = [clean(c.name), clean(c.designation) ? `(${clean(c.designation)})` : ''].filter(Boolean).join(' ');
  return [head, clean(c.mobile) || clean(c.tel), clean(c.email)].filter(Boolean).join(' · ');
}

export async function buildBackupData(admin) {
  const { data: rawProjects, error: projectsError } = await admin
    .from('projects')
    .select('*, creator:profiles!created_by(full_name)');
  if (projectsError) return { error: 'Failed to fetch projects' };

  const [{ data: rawQuotations, error: quotationsError }, { data: rawContacts, error: contactsError }] = await Promise.all([
    admin.from('quotations').select('*'),
    admin.from('contacts').select('*').order('created_at', { ascending: true }),
  ]);
  const quotations = quotationsError ? [] : (rawQuotations || []);
  const contacts = contactsError ? [] : (rawContacts || []);

  // Map each project to its most recent quotation (if it has one)
  const latestQuotationByProject = {};
  quotations.forEach((q) => {
    const existing = latestQuotationByProject[q.project_id];
    if (!existing || new Date(q.created_at) > new Date(existing.created_at)) {
      latestQuotationByProject[q.project_id] = q;
    }
  });

  // Group contacts by project and role
  const contactsByProject = {};
  contacts.forEach((c) => {
    if (!contactsByProject[c.project_id]) contactsByProject[c.project_id] = {};
    const byRole = contactsByProject[c.project_id];
    if (!byRole[c.contact_role]) byRole[c.contact_role] = [];
    byRole[c.contact_role].push(c);
  });

  const projectNameById = {};
  (rawProjects || []).forEach((p) => { projectNameById[p.id] = p.name; });

  // Flatten the joined creator name (into created_by, replacing the raw user id),
  // merge in that project's quotation details, then add one company column and
  // one contacts column per role (several contacts are joined with " | ").
  const projects = (rawProjects || []).map((p) => {
    const { creator, created_by, ...rest } = p;

    const matchedQuotation = latestQuotationByProject[p.id];
    let quotationFields = {};
    if (matchedQuotation) {
      const { id, project_id, created_at, quotation_number, ...qRest } = matchedQuotation;
      quotationFields = {
        quotation_id: quotation_number || '',
        quotation_number,
        ...qRest,
        quotation_created_at: created_at,
      };
    }

    const contactFields = {};
    const byRole = contactsByProject[p.id] || {};
    ROLE_ORDER.forEach((role) => {
      const list = byRole[role] || [];
      const companies = [...new Set(list.map((c) => clean(c.company_name)).filter(Boolean))];
      contactFields[`${role}_company`] = companies.join(' | ');
      contactFields[`${role}_contacts`] = list.map(contactLine).filter(Boolean).join(' | ');
    });

    return stripIds(formatRowDates({
      ...rest,
      status: projectStatusLabel(rest.status), // "Job In Hand", not "job_in_hand"
      created_by: creator?.full_name || '',
      ...quotationFields,
      ...contactFields,
    }));
  });

  const quotationRows = quotations.map((q) => {
    const { created_by, ...rest } = q;
    return stripIds(formatRowDates(rest));
  });

  // One row per contact, with the project name and role spelled out
  const contactRows = contacts
    .map((c) => ({
      project: projectNameById[c.project_id] || '',
      role: ROLE_LABELS[c.contact_role] || c.contact_role,
      company_name: clean(c.company_name) || '',
      name: clean(c.name) || '',
      designation: clean(c.designation) || '',
      tel: clean(c.tel) || '',
      mobile: clean(c.mobile) || '',
      email: clean(c.email) || '',
      added_on: c.created_at,
      _sort: `${projectNameById[c.project_id] || ''}|${ROLE_ORDER.indexOf(c.contact_role)}`,
    }))
    .sort((a, b) => a._sort.localeCompare(b._sort))
    .map(({ _sort, ...r }) => formatRowDates(r));

  return { projects, quotations: quotationRows, contacts: contactRows };
}
