export interface OnboardingFieldDef {
  key: string;
  label: string;
  description: string;
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'date' | 'boolean' | 'number' | 'phone' | 'email';
  category: 'spiritual' | 'personal' | 'interests' | 'family' | 'background' | 'custom';
  options?: string[];
  placeholder?: string;
  mapsTo?: string; // maps to member_journeys or users field for auto-population
}

export const FIELD_LIBRARY: OnboardingFieldDef[] = [
  // ─── SPIRITUAL ───
  { key: 'is_saved', label: 'Have you accepted Jesus Christ as your Lord and Savior?', description: 'Salvation status', type: 'boolean', category: 'spiritual', mapsTo: 'journey.salvation' },
  { key: 'salvation_date', label: 'When were you saved?', description: 'Date or approximate year of salvation', type: 'text', category: 'spiritual', placeholder: 'e.g., June 2020 or 2018', mapsTo: 'journey.salvationDate' },
  { key: 'is_baptized', label: 'Have you been baptized?', description: 'Water baptism status', type: 'boolean', category: 'spiritual', mapsTo: 'journey.isBaptized' },
  { key: 'baptism_date', label: 'When were you baptized?', description: 'Date or approximate year', type: 'text', category: 'spiritual', placeholder: 'e.g., March 2021', mapsTo: 'journey.baptismDate' },
  { key: 'baptism_interest', label: 'Are you interested in being baptized?', description: 'For unbaptized members', type: 'boolean', category: 'spiritual' },
  { key: 'holy_spirit', label: 'Have you received the Holy Spirit?', description: 'Holy Spirit experience', type: 'boolean', category: 'spiritual' },
  { key: 'previous_church', label: 'What church were you attending previously?', description: 'Previous church affiliation', type: 'text', category: 'spiritual', placeholder: 'Church name or "None"' },
  { key: 'how_long_christian', label: 'How long have you been a Christian?', description: 'Faith journey duration', type: 'select', category: 'spiritual', options: ['New believer (< 1 year)', '1-3 years', '3-5 years', '5-10 years', '10+ years', 'Exploring faith'] },
  { key: 'faith_journey', label: 'Where would you say you are in your faith journey?', description: 'Self-assessed spiritual stage', type: 'select', category: 'spiritual', options: ['Just exploring', 'New believer', 'Growing in faith', 'Mature believer', 'Ready to lead/serve'] },
  { key: 'discipleship_interest', label: 'Are you interested in a discipleship program?', description: 'Interest in discipleship/mentoring', type: 'boolean', category: 'spiritual' },

  // ─── PERSONAL ───
  { key: 'date_of_birth', label: 'Date of Birth', description: 'Birthday for church records', type: 'date', category: 'personal' },
  { key: 'gender', label: 'Gender', description: 'Gender identity', type: 'select', category: 'personal', options: ['Male', 'Female', 'Prefer not to say'] },
  { key: 'address', label: 'Home Address', description: 'Street address', type: 'textarea', category: 'personal', placeholder: '123 Main St, City, State ZIP' },
  { key: 'city', label: 'City', description: 'City of residence', type: 'text', category: 'personal' },
  { key: 'state', label: 'State', description: 'State/Province', type: 'text', category: 'personal' },
  { key: 'zip_code', label: 'ZIP Code', description: 'Postal code', type: 'text', category: 'personal' },
  { key: 'phone_secondary', label: 'Secondary Phone Number', description: 'Alternate contact', type: 'phone', category: 'personal' },
  { key: 'emergency_contact', label: 'Emergency Contact Name', description: 'In case of emergency', type: 'text', category: 'personal' },
  { key: 'emergency_phone', label: 'Emergency Contact Phone', description: 'Emergency contact number', type: 'phone', category: 'personal' },
  { key: 'how_did_you_hear', label: 'How did you hear about us?', description: 'Referral source tracking', type: 'select', category: 'personal', options: ['Friend/Family', 'Social Media', 'Website', 'Drive-by', 'Online Search', 'Community Event', 'Other'] },
  { key: 'how_did_you_hear_detail', label: 'If referred, who invited you?', description: 'Specific referral', type: 'text', category: 'personal', placeholder: 'Name of person who invited you' },

  // ─── FAMILY ───
  { key: 'marital_status', label: 'Marital Status', description: 'Current marital status', type: 'select', category: 'family', options: ['Single', 'Married', 'Divorced', 'Widowed', 'Separated'] },
  { key: 'spouse_name', label: 'Spouse Name', description: 'If married', type: 'text', category: 'family' },
  { key: 'wedding_anniversary', label: 'Wedding Anniversary', description: 'Anniversary date', type: 'date', category: 'family' },
  { key: 'children_count', label: 'Number of Children', description: 'How many children', type: 'number', category: 'family' },
  { key: 'children_names_ages', label: 'Children Names & Ages', description: 'List children', type: 'textarea', category: 'family', placeholder: 'Sarah (12), Michael (8), Emma (5)' },
  { key: 'family_in_church', label: 'Do you have family members already in our church?', description: 'Existing family connections', type: 'text', category: 'family', placeholder: 'Names of family members' },

  // ─── INTERESTS & SKILLS ───
  { key: 'interests', label: 'What areas of ministry interest you?', description: 'Ministry interests for placement', type: 'multiselect', category: 'interests', options: ['Worship/Music', 'Youth Ministry', 'Children\'s Ministry', 'Small Groups', 'Outreach/Missions', 'Prayer Ministry', 'Media/Tech', 'Hospitality/Greeting', 'Teaching/Bible Study', 'Counseling/Care', 'Administration', 'Men\'s Ministry', 'Women\'s Ministry', 'Senior\'s Ministry', 'Food/Kitchen', 'Maintenance/Facilities'], mapsTo: 'journey.interests' },
  { key: 'skills', label: 'What skills or talents do you have?', description: 'Professional/personal skills', type: 'multiselect', category: 'interests', options: ['Music/Singing', 'Musical Instrument', 'Teaching', 'Counseling', 'IT/Technology', 'Graphic Design', 'Video/Photography', 'Writing', 'Cooking/Baking', 'Construction/Handyman', 'Medical/Nursing', 'Legal', 'Financial/Accounting', 'Event Planning', 'Public Speaking', 'Languages/Translation'], mapsTo: 'journey.skills' },
  { key: 'volunteer_interest', label: 'Would you like to volunteer?', description: 'Volunteer willingness', type: 'boolean', category: 'interests' },
  { key: 'small_group_interest', label: 'Are you interested in joining a small group?', description: 'Small group interest', type: 'boolean', category: 'interests' },
  { key: 'preferred_service', label: 'Which service time do you prefer?', description: 'Preferred service', type: 'select', category: 'interests', options: ['Early Morning', 'Mid-Morning', 'Afternoon', 'Evening', 'No preference'] },
  { key: 'communication_preference', label: 'How would you like us to contact you?', description: 'Preferred contact method', type: 'multiselect', category: 'interests', options: ['Email', 'Text/SMS', 'Phone Call', 'Church App'] },

  // ─── BACKGROUND ───
  { key: 'occupation', label: 'Occupation', description: 'Current job or profession', type: 'text', category: 'background', placeholder: 'e.g., Teacher, Engineer, Student' },
  { key: 'employer', label: 'Employer/School', description: 'Where you work or study', type: 'text', category: 'background' },
  { key: 'education', label: 'Highest Education Level', description: 'Education background', type: 'select', category: 'background', options: ['High School', 'Some College', 'Associate Degree', 'Bachelor\'s Degree', 'Master\'s Degree', 'Doctorate', 'Trade/Vocational', 'Other'] },
  { key: 'military', label: 'Are you a veteran or active military?', description: 'Military service', type: 'select', category: 'background', options: ['No', 'Active Duty', 'Veteran', 'Reserves', 'Military Spouse'] },
  { key: 'special_needs', label: 'Do you or a family member have any special needs we should know about?', description: 'Accessibility or special accommodations', type: 'textarea', category: 'background', placeholder: 'Allergies, disabilities, dietary needs, etc.' },
  { key: 'prayer_request', label: 'Is there anything you would like us to pray about?', description: 'Initial prayer request', type: 'textarea', category: 'background', placeholder: 'Share anything on your heart...' },
  { key: 'additional_info', label: 'Is there anything else you would like us to know?', description: 'Open-ended catch-all', type: 'textarea', category: 'background' },
];

/** FIELD_LIBRARY indexed by key for quick lookups */
export const FIELD_LIBRARY_MAP: Record<string, OnboardingFieldDef> = {};
for (const field of FIELD_LIBRARY) {
  FIELD_LIBRARY_MAP[field.key] = field;
}
