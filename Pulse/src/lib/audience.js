/**
 * audience.js — the two audience targets the dashboard ranks channels for.
 *
 * Moved out of DiagnosisPanel.jsx in v4.3.5, when that panel was removed from
 * the dashboard: the focus board still needs the same two options, and a shared
 * constant must not live in a component that no longer exists.
 */
export const AUDIENCE_OPTIONS = [
  {
    value: 'institutions',
    label: 'Universities & institutes',
    title: 'Admissions teams, colleges, schools, coaching institutes, ed-tech buyers',
  },
  {
    value: 'students',
    label: 'Students & parents',
    title: 'Learners, aspirants and the parents who decide for them',
  },
]
