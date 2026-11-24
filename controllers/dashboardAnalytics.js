import { dashboardAnalytics } from '../services/dashboardAnalytics.js';
import { dashboardPeriod } from '../services/dashboardPeriod.js';

export async function learningAnalytics(req, res) {
  const range = dashboardPeriod(req.query);
  if (!range) return res.status(400).json({ message: 'Choose valid dates and a range of up to 366 days.' });
  res.json(await dashboardAnalytics(range));
}
