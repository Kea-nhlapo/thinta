// Fika's demo school. Every capacity and queue here is a DEMO VALUE, chosen to be plausible, and the UI says so:
// Fika does not control real printers yet; it produces the schedule and the print files.
export const DEMO_SCHOOL = {
  id: 'demo-school', name: 'Demo School for the Blind', timezone: 'Africa/Johannesburg',
  hours: { open: '07:30', close: '16:30', days: [1, 2, 3, 4, 5] },
  // Simulated "now" for the demo: Thursday lunchtime, the day before the lesson.
  clockStart: '2026-11-19T13:00:00+02:00',
  lesson: { title: 'Grade 10 maths: parabolas', at: '2026-11-20T08:00:00+02:00' },
  demoValues: true,
  machines: [
    // Swell paper is heated sheet by sheet, and other classes already have work waiting on both tactile machines.
    { id: 'swell-1', name: 'Swell-paper heater', kind: 'swell', pagesPerHour: 40, online: true, queue: [{ id: 'q-swell-1', label: 'Grade 8 geography maps', pages: 80 }] },
    { id: 'embosser-1', name: 'Braille embosser', kind: 'embosser', pagesPerHour: 30, online: true, queue: [{ id: 'q-emb-1', label: 'Grade 11 English set work', pages: 45 }] },
    { id: 'printer-1', name: 'Office printer', kind: 'printer', pagesPerHour: 900, online: true, queue: [] },
  ],
  learners: [
    { id: 'l1', name: 'Learner A', needs: ['tactile', 'phone-blind'] },
    { id: 'l2', name: 'Learner B', needs: ['tactile', 'phone-blind'] },
    { id: 'l3', name: 'Learner C', needs: ['tactile'] },
    { id: 'l4', name: 'Learner D', needs: ['deaf-solution'] },
    { id: 'l5', name: 'Learner E', needs: ['deaf-solution'] },
    { id: 'l6', name: 'Learner F', needs: ['tactile', 'phone-blind'] },
  ],
};
// Items are due half an hour before the lesson starts.
export const DEMO_DEADLINE = '2026-11-20T07:30:00+02:00';
export const DEMO_SCHOOLS = { [DEMO_SCHOOL.id]: DEMO_SCHOOL };
