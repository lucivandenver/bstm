// Starter learning content for development. Faculty must validate against the actual syllabus before academic use.
const q = (id, prompt, options, answer, explanation, domain, moduleId) => ({ id, prompt, options, answer, explanation, domain, moduleId });
export const domains = ['Tourism knowledge', 'Communication', 'Workplace', 'Digital skills'];
export const starterCourses = [
  {
    slug: 'travel-tour-foundations', title: 'Travel & Tour Operations Foundations', domain: domains[0], level: 'Foundation', minutes: 45,
    description: 'Build a simple itinerary, understand tour costing, and plan responsible visitor experiences.', passingScore: 75,
    modules: [
      { id: 'planning', title: 'Plan a visitor experience', lessons: [
        { id: 'traveller', title: 'Understand your traveller', body: 'Start with the traveller’s dates, budget, interests, mobility needs and group size. Confirm requirements before recommending transport or accommodation. Ask permission before collecting personal information and share it only with authorised providers.', takeaways: ['Confirm requirements before booking.', 'Consider accessibility and budget.'] },
        { id: 'itinerary', title: 'Build a realistic itinerary', body: 'An itinerary combines activities, travel time, meal breaks and contingency time. Check opening hours and supplier availability. Avoid filling every minute: allow for traffic and delays. Give the traveller clear inclusions, exclusions and cancellation terms.', takeaways: ['Allow travel and contingency time.', 'Communicate inclusions and exclusions.'] }
      ] },
      { id: 'responsible', title: 'Cost and operate responsibly', lessons: [
        { id: 'cost', title: 'Understand tour costing', body: 'Separate fixed group costs, such as vehicle hire, from variable per-person costs, such as entrance fees. Divide group costs by the paying participants before adding per-person costs. State assumptions and distinguish markup on cost from profit margin on selling price.', takeaways: ['Separate fixed and variable costs.', 'Recalculate when group size changes.'] },
        { id: 'community', title: 'Support destinations and communities', body: 'Respect local rules and customs, use authorised providers and reduce waste. Explain visitor conduct before arrival. Build contingency contacts and an incident response plan. Safety and community welfare take priority over keeping every activity on schedule.', takeaways: ['Respect local communities.', 'Prioritise safety when plans change.'] }
      ] }
    ],
    questions: [
      q('t1', 'What should be confirmed before recommending a tour?', ['Traveller needs and budget', 'Only the guide’s favourite place', 'Only the commission', 'Nothing until payment'], 0, 'The plan should respond to the traveller’s requirements.', domains[0], 'planning'),
      q('t2', 'Why include contingency time in an itinerary?', ['To guarantee all suppliers are free', 'To accommodate delays', 'To remove meal breaks', 'To avoid checking opening hours'], 1, 'A realistic plan allows for traffic and other delays.', domains[0], 'planning'),
      q('t3', 'Which is normally a fixed group cost?', ['Per-person entrance ticket', 'Each traveller’s meal', 'Vehicle hire for the group', 'Individual souvenir'], 2, 'Group vehicle hire is allocated across participants.', domains[0], 'responsible'),
      q('t4', 'A destination closes because of unsafe weather. What comes first?', ['Continue to avoid complaints', 'Ignore the closure', 'Remove the safety briefing', 'Use the safety and contingency plan'], 3, 'Safety takes priority over the original schedule.', domains[0], 'responsible')
    ]
  },
  {
    slug: 'guest-communication', title: 'Guest Communication & Service Recovery', domain: domains[1], level: 'Foundation', minutes: 40,
    description: 'Practise clear guest communication, active listening and appropriate complaint handling.', passingScore: 75,
    modules: [
      { id: 'listen', title: 'Communicate clearly', lessons: [
        { id: 'listening', title: 'Active listening', body: 'Give the guest your attention, listen without interrupting and ask clarifying questions. Restate the concern in your own words and confirm you understood it. Speak clearly and avoid jargon. Check understanding rather than assuming silence means agreement.', takeaways: ['Clarify and confirm understanding.', 'Use plain, respectful language.'] },
        { id: 'inclusive', title: 'Inclusive guest communication', body: 'Ask what assistance the guest prefers. Do not make assumptions about ability, language or culture. Offer written instructions or another communication channel when useful. Protect personal details and discuss sensitive concerns privately.', takeaways: ['Ask about preferred assistance.', 'Respect privacy.'] }
      ] },
      { id: 'recover', title: 'Handle concerns professionally', lessons: [
        { id: 'complaint', title: 'Service recovery', body: 'Acknowledge the concern, apologise appropriately and clarify the facts. Explain available options within your authority and agree on a next step. Escalate safety issues and requests beyond your authority. Record the concern and follow up without promising an outcome you cannot deliver.', takeaways: ['Offer realistic next steps.', 'Escalate beyond your authority.'] }
      ] }
    ],
    questions: [
      q('c1', 'How do you check you understood a guest’s concern?', ['Interrupt immediately', 'Restate it and ask for confirmation', 'Assume the cause', 'Change the topic'], 1, 'Restating and confirming helps prevent misunderstanding.', domains[1], 'listen'),
      q('c2', 'A guest needs a different communication format. What should you do?', ['Refuse assistance', 'Make assumptions', 'Ask their preferred assistance', 'Discuss it publicly'], 2, 'Ask the guest what assistance works for them.', domains[1], 'listen'),
      q('c3', 'A requested refund exceeds your authority. What is appropriate?', ['Guarantee it', 'Ignore the request', 'Delete the complaint', 'Explain and escalate to the authorised person'], 3, 'Stay within your authority and escalate appropriately.', domains[1], 'recover'),
      q('c4', 'What follows an agreed service recovery action?', ['Record and follow up', 'Promise anything', 'Blame the guest', 'Share personal details publicly'], 0, 'Documentation and follow-up help close the concern.', domains[1], 'recover')
    ]
  },
  {
    slug: 'workplace-readiness', title: 'Professional Workplace Readiness', domain: domains[2], level: 'Foundation', minutes: 35,
    description: 'Prepare for teamwork, professional conduct, shift handovers and safe workplace decisions.', passingScore: 75,
    modules: [
      { id: 'team', title: 'Work as a professional team', lessons: [
        { id: 'handover', title: 'Reliable shift handovers', body: 'A handover should communicate unfinished work, guest concerns, deadlines and the person responsible for each next action. Use the approved record and confirm that the receiving colleague understands. Keep information factual and relevant.', takeaways: ['Assign ownership and next steps.', 'Use approved records.'] },
        { id: 'conduct', title: 'Professional conduct', body: 'Arrive prepared, communicate delays early and follow the workplace code of conduct. Protect confidential information. Address disagreement respectfully using evidence and shared service goals. Ask for help when a task is beyond your training.', takeaways: ['Communicate early.', 'Protect confidentiality.'] }
      ] },
      { id: 'safe', title: 'Respond safely', lessons: [
        { id: 'incident', title: 'Recognise and report hazards', body: 'Follow the workplace emergency procedure when there is immediate danger. Alert the appropriate person and help others within your training. Report observations accurately. Do not improvise technical repairs or medical actions beyond your competence.', takeaways: ['Follow emergency procedures.', 'Act within your training.'] }
      ] }
    ],
    questions: [
      q('w1', 'Which belongs in a shift handover?', ['Unverified gossip', 'Private passwords', 'Unfinished work and responsible next person', 'Only yesterday’s weather'], 2, 'A handover gives actionable, relevant information.', domains[2], 'team'),
      q('w2', 'You will be late for a shift. What should you do?', ['Say nothing', 'Ask a guest to cover', 'Change the attendance record', 'Notify the responsible supervisor early'], 3, 'Early communication helps the team respond.', domains[2], 'team'),
      q('w3', 'What should guide your response to an immediate hazard?', ['The workplace emergency procedure', 'An untrained repair attempt', 'A social-media poll', 'Keeping it secret'], 0, 'Use established procedures and stay within your training.', domains[2], 'safe'),
      q('w4', 'How should an incident report describe events?', ['With speculation', 'Factually and accurately', 'With unrelated personal details', 'Without any observations'], 1, 'Reports should accurately record relevant observations.', domains[2], 'safe')
    ]
  },
  {
    slug: 'tourism-digital-skills', title: 'Digital Skills for Tourism Services', domain: domains[3], level: 'Foundation', minutes: 45,
    description: 'Develop safer digital habits and organise tourism service data accurately.', passingScore: 75,
    modules: [
      { id: 'data', title: 'Organise service information', lessons: [
        { id: 'spreadsheets', title: 'Spreadsheet basics', body: 'Use clearly labelled columns, consistent date formats and one record per row. Check formulas against known examples. A SUM formula adds values in a range. Filter records without deleting the underlying data and keep a backup before large edits.', takeaways: ['Use consistent formats.', 'Check formulas with known values.'] },
        { id: 'systems', title: 'Reservation data accuracy', body: 'Confirm the guest’s name, dates, room or service type and applicable terms before saving a reservation. Review changes and communicate them through approved channels. A property management system supports hotel operations; access is limited by assigned permissions.', takeaways: ['Verify details before saving.', 'Use only authorised access.'] }
      ] },
      { id: 'security', title: 'Protect digital information', lessons: [
        { id: 'phishing', title: 'Recognise suspicious messages', body: 'Unexpected urgency, unusual links and requests for passwords are warning signs. Verify the sender through a known channel before opening suspicious attachments or entering credentials. Use unique passwords and multifactor authentication. Never share guest data in public links.', takeaways: ['Verify suspicious requests independently.', 'Limit access to guest data.'] }
      ] }
    ],
    questions: [
      q('d1', 'What does a SUM formula normally do?', ['Delete rows', 'Encrypt passwords', 'Book flights', 'Add values in a range'], 3, 'SUM adds numeric values.', domains[3], 'data'),
      q('d2', 'Before saving a reservation, what should you verify?', ['Guest details, dates and terms', 'Only the screen colour', 'Only a colleague’s guess', 'Nothing if busy'], 0, 'Accurate details reduce service errors.', domains[3], 'data'),
      q('d3', 'An unexpected message asks for your password. What should you do?', ['Reply with the password', 'Verify through a known channel', 'Forward guest records', 'Disable all checks'], 1, 'Independent verification helps identify phishing.', domains[3], 'security'),
      q('d4', 'How should a guest-data report be shared?', ['Public anonymous link', 'Social-media post', 'Approved access-controlled channel', 'Any group chat'], 2, 'Access should be limited to authorised recipients.', domains[3], 'security')
    ]
  }
];
export const baselineQuestions = starterCourses.flatMap(c => c.questions.slice(0, 2));
