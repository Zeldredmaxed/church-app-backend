/**
 * Family Connection Type System
 *
 * Relationships are stored as category-level enums (e.g. "spouse", "parent").
 * Human-readable labels ("Wife", "Mother") are resolved at runtime using
 * the TARGET user's gender.
 */

/** The 13 relationship categories stored in the DB */
export type Relationship =
  | 'spouse'
  | 'child'
  | 'parent'
  | 'sibling'
  | 'grandparent'
  | 'grandchild'
  | 'uncle_aunt'
  | 'nephew_niece'
  | 'cousin'
  | 'parent_in_law'
  | 'child_in_law'
  | 'sibling_in_law'
  | 'cousin_in_law';

export const ALL_RELATIONSHIPS: Relationship[] = [
  'spouse', 'child', 'parent', 'sibling',
  'grandparent', 'grandchild', 'uncle_aunt', 'nephew_niece', 'cousin',
  'parent_in_law', 'child_in_law', 'sibling_in_law', 'cousin_in_law',
];

// ─── Inverse map: A→B relationship X  ⇒  B→A relationship Y ───

export const INVERSE: Record<Relationship, Relationship> = {
  spouse: 'spouse',
  parent: 'child',
  child: 'parent',
  sibling: 'sibling',
  grandparent: 'grandchild',
  grandchild: 'grandparent',
  uncle_aunt: 'nephew_niece',
  nephew_niece: 'uncle_aunt',
  cousin: 'cousin',
  parent_in_law: 'child_in_law',
  child_in_law: 'parent_in_law',
  sibling_in_law: 'sibling_in_law',
  cousin_in_law: 'cousin_in_law',
};

// ─── Label resolution: relationship + target gender → human label ───

const LABEL_TABLE: Record<Relationship, { male: string; female: string; unknown: string }> = {
  spouse:          { male: 'Husband',          female: 'Wife',              unknown: 'Spouse' },
  parent:          { male: 'Father',           female: 'Mother',            unknown: 'Parent' },
  child:           { male: 'Son',              female: 'Daughter',          unknown: 'Child' },
  sibling:         { male: 'Brother',          female: 'Sister',            unknown: 'Sibling' },
  grandparent:     { male: 'Grandfather',      female: 'Grandmother',      unknown: 'Grandparent' },
  grandchild:      { male: 'Grandson',         female: 'Granddaughter',    unknown: 'Grandchild' },
  uncle_aunt:      { male: 'Uncle',            female: 'Aunt',             unknown: 'Uncle/Aunt' },
  nephew_niece:    { male: 'Nephew',           female: 'Niece',            unknown: 'Nephew/Niece' },
  cousin:          { male: 'Cousin',           female: 'Cousin',           unknown: 'Cousin' },
  parent_in_law:   { male: 'Father-in-Law',    female: 'Mother-in-Law',    unknown: 'Parent-in-Law' },
  child_in_law:    { male: 'Son-in-Law',       female: 'Daughter-in-Law',  unknown: 'Child-in-Law' },
  sibling_in_law:  { male: 'Brother-in-Law',   female: 'Sister-in-Law',    unknown: 'Sibling-in-Law' },
  cousin_in_law:   { male: 'Cousin-in-Law',    female: 'Cousin-in-Law',    unknown: 'Cousin-in-Law' },
};

/**
 * Resolve a human-readable label based on relationship + the target's gender.
 * Gender should be "Male", "Female", or null/undefined for unknown.
 */
export function resolveLabel(relationship: Relationship, targetGender?: string | null): string {
  const entry = LABEL_TABLE[relationship];
  if (!entry) return relationship;
  const g = targetGender?.toLowerCase();
  if (g === 'male') return entry.male;
  if (g === 'female') return entry.female;
  return entry.unknown;
}

// ─── Spouse propagation: when A↔B are spouses and A→C exists ───
// Maps A→C relationship to the B→C relationship that should be created.
// null = don't propagate (avoids double-derivation).

export const SPOUSE_PROPAGATION: Record<Relationship, Relationship | null> = {
  spouse: null,
  parent: 'parent_in_law',
  child: 'child',               // shared children — both parents
  sibling: 'sibling_in_law',
  grandparent: null,
  grandchild: 'grandchild',     // shared grandchildren
  uncle_aunt: null,
  nephew_niece: null,
  cousin: 'cousin_in_law',
  parent_in_law: null,
  child_in_law: null,
  sibling_in_law: null,
  cousin_in_law: null,
};
