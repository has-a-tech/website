// Which email domains count as a school.
//
// A domain matches if it is listed below, or is a subdomain of a listed one
// (so "mail.utoronto.ca" matches "utoronto.ca"), or matches a pattern.
//
// To add a school: confirm the domain only gives addresses to students/staff
// of that school, then add it to SCHOOL_DOMAINS in alphabetical order.

export const SCHOOL_PATTERNS = [
  /\.edu$/, // US universities and colleges
  /\.edu\.[a-z]{2}$/, // e.g. edu.au, edu.in, edu.sg, edu.mx
  /\.ac\.[a-z]{2}$/, // e.g. ac.uk, ac.in, ac.nz, ac.jp
  /\.k12\.[a-z]{2}\.us$/, // US K-12 school districts
  /\.sch\.uk$/, // UK schools
];

export const SCHOOL_DOMAINS = [
  // Canada: universities
  "brocku.ca", "carleton.ca", "concordia.ca", "dal.ca", "laurentian.ca",
  "mcgill.ca", "mcmaster.ca", "mun.ca", "queensu.ca", "ryerson.ca",
  "sfu.ca", "torontomu.ca", "trentu.ca", "ualberta.ca", "ubc.ca",
  "ucalgary.ca", "umanitoba.ca", "umontreal.ca", "unb.ca", "uoguelph.ca",
  "uottawa.ca", "uregina.ca", "usask.ca", "utoronto.ca", "uvic.ca",
  "uwaterloo.ca", "uwindsor.ca", "uwo.ca", "wlu.ca", "yorku.ca",
  "ontariotechu.net",
  // Canada: colleges
  "centennialcollege.ca", "georgebrown.ca", "myseneca.ca", "senecapolytechnic.ca",
  "sheridancollege.ca",
];

// Common personal email providers, rejected with a clearer message.
export const PERSONAL_PROVIDERS = [
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com",
];

const EMAIL_RE = /^[a-z0-9._%+-]{1,64}@([a-z0-9-]{1,63}\.)+[a-z]{2,24}$/;

export function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

export function checkSchoolEmail(email) {
  if (!EMAIL_RE.test(email)) return { ok: false, reason: "invalid" };
  const domain = email.split("@")[1];
  if (PERSONAL_PROVIDERS.includes(domain)) return { ok: false, reason: "personal", domain };
  if (SCHOOL_PATTERNS.some((re) => re.test(domain))) return { ok: true, domain };
  const match = SCHOOL_DOMAINS.find((d) => domain === d || domain.endsWith("." + d));
  if (match) return { ok: true, domain: match };
  return { ok: false, reason: "unknown", domain };
}
