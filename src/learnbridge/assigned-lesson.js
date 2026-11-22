// Hands a lesson from the learner's page (/learn) to the quiz screens (/app?screen=path). Kept for this tab only,
// so a reload keeps the lesson open and closing the tab forgets it.
const KEY = 'sae-assigned-lesson';

export function openAssignedLesson(lesson) {
  try { sessionStorage.setItem(KEY, JSON.stringify(lesson)); } catch {}
}

export function assignedLesson() {
  try { return JSON.parse(sessionStorage.getItem(KEY)) || null; } catch { return null; }
}
