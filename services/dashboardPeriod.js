const DAY = 86_400_000;
const manila = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila' });
export const philippineDate = date => manila.format(date);
const midnight = date => new Date(`${date}T00:00:00+08:00`);
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(+midnight(value)) && philippineDate(midnight(value)) === value;
const periods = { day: 1, week: 7, month: 30 };

export function dashboardPeriod({ period = 'week', start, end }, now = new Date()) {
  if (typeof period !== 'string') return null;
  const today = philippineDate(now);
  if (Object.hasOwn(periods, period)) {
    end = today;
    start = philippineDate(new Date(+midnight(end) - (periods[period] - 1) * DAY));
  } else if (period !== 'custom') return null;
  if (!validDay(start) || !validDay(end) || start > end || end > today) return null;
  const from = midnight(start);
  const through = new Date(+midnight(end) + DAY);
  if ((through - from) / DAY > 366) return null;
  return { start, end, from, through };
}
