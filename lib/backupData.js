// Builds the data for the Excel backup and the "View Data" page, so the
// two always show exactly the same thing. Server-only (uses the admin
// client passed in).

import { toRegisterRow, latestQuotation } from '@/lib/projectTable';

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

  // Projects: the same columns, in the same order, as the My Projects
  // table (Date … Note), then the remaining project details.
  const quotationsByProject = {};
  quotations.forEach((q) => { (quotationsByProject[q.project_id] ||= []).push(q); });

  // newest first, by the same Date the My Projects table shows
  const projectDate = (p) => (latestQuotation(quotationsByProject[p.id])?.quotation_date || String(p.created_at || '').slice(0, 10));
  const orderedProjects = [...(rawProjects || [])].sort((a, b) => projectDate(b).localeCompare(projectDate(a)));

  const projects = orderedProjects.map((p) => {
    const reg = toRegisterRow({ ...p, quotations: quotationsByProject[p.id] || [], contacts: contacts.filter((c) => c.project_id === p.id) });
    const latest = latestQuotation(quotationsByProject[p.id]); // same choice as the table
    const byRole = contactsByProject[p.id] || {};
    const people = (role) => (byRole[role] || []).map(contactLine).filter(Boolean).join(' | ');
    const companies = (role) => [...new Set((byRole[role] || []).map((c) => clean(c.company_name) || clean(c.name)).filter(Boolean))].join(' | ');

    return formatRowDates({
      date: reg.date,
      quotation_no: reg.quotation_no,
      status: reg.status_label,
      progress: `${reg.progress}%`,
      sales_person: reg.sales_person,
      headed_by: reg.headed_by,
      project_name: reg.name,
      contractor: reg.contractor,
      client: reg.client,
      consultant: reg.consultant,
      value: reg.value,
      brands: reg.brands.split(' | ').join(', '),
      note: reg.note,
      lead_by: clean(p.lead_by) || '',
      location: clean(p.location) || '',
      main_contractor: companies('main_contractor'),
      quotation_status: latest?.quotation_status || '',
      target_submission_date: latest?.target_submission_date || '',
      quotations_count: (quotationsByProject[p.id] || []).length,
      contractor_contacts: people('contractor'),
      client_contacts: people('client'),
      consultant_contacts: people('consultant'),
      main_contractor_contacts: people('main_contractor'),
      created_by: p.creator?.full_name || '',
      created_at: p.created_at,
    });
  });

  // Quotations: only the fields ACE still uses
  const quotationRows = [...quotations]
    .sort((a, b) => String(b.quotation_date || '').localeCompare(String(a.quotation_date || '')))
    .map((q) => formatRowDates({
      project: projectNameById[q.project_id] || '',
      quotation_number: clean(q.quotation_number) || '',
      quotation_date: q.quotation_date || '',
      target_submission_date: q.target_submission_date || '',
      quotation_value: q.quotation_value ?? '',
      quotation_status: q.quotation_status || '',
      added_on: q.created_at,
    }));

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
