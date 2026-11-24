import { analyticsRange, dashboardAnalytics } from '../services/dashboardAnalytics.js';

export async function learningAnalytics(req, res) {
  const range = analyticsRange(req.query);
  if (!range) return res.status(400).json({ message: 'Choose valid dates and a range of up to 366 days.' });
  res.json(await dashboardAnalytics(range, req.user.role === 'faculty' ? req.user.id : undefined));
}
