// Evidence mapping uses published module metadata; unmatched material earns no sector credit.
export const careerSectors = [
  { name: 'Travel and Tour Operations', terms: /\b(travel|tour operations?|booking|reservations?|itinerar\w*|tourism service)\b/i, roles: ['Travel Consultant / Tour Operations Assistant', 'Reservations Assistant', 'Travel Agency Operations Assistant'] },
  { name: 'Hotel and Resort Operations', terms: /\b(hotel|resort|front office|guest services?|housekeeping|accommodation)\b/i, roles: ['Guest Services / Front Office Assistant', 'Hotel Reservations Assistant', 'Resort Operations Assistant'] },
  { name: 'Airline and Airport Services', terms: /\b(airline|airport|aviation|ticketing|air passenger|ground handling)\b/i, roles: ['Airline Passenger Services Assistant', 'Airport Ground Services Assistant', 'Airline Ticketing Assistant'] },
  { name: 'Events and MICE', terms: /\b(events?|mice|meetings?|conferences?|conventions?|exhibitions?|banquet)\b/i, roles: ['Events Coordination Assistant', 'Banquet Operations Assistant', 'Conference and Exhibition Assistant'] },
  { name: 'Tourism Destination/Community Management', terms: /\b(destination|community|visitor|tour guiding|tour guide|heritage|ecotourism|tourism information)\b/i, roles: ['Tourism Information Assistant', 'Tour Guiding Assistant', 'Destination Visitor Services Assistant', 'Destination Operations Assistant', 'Community Tourism Assistant'] },
  { name: 'Food and Beverage Services', terms: /\b(food|beverage|restaurant|dining|catering|table service)\b/i, roles: ['Food and Beverage Service Assistant', 'Restaurant Service Assistant', 'Catering Operations Assistant'] },
  { name: 'Cruise and Recreation Services', terms: /\b(cruise|recreation|leisure|shipboard|recreational|adventure tourism)\b/i, roles: ['Cruise Guest Services Assistant', 'Recreation Activities Assistant', 'Leisure Operations Assistant'] },
  { name: 'General Management/Entrepreneurship', terms: /\b(entrepreneur\w*|business plan|business management|small business|enterprise|startup|strategic management)\b/i, roles: ['Tourism Enterprise Assistant', 'Small Tourism Business Operations Assistant', 'Tourism Marketing Assistant'] }
];
export function sectorsForModule(course, module) {
  const own = [module.title, ...(module.outcomes || []), ...(module.lessons || []).map(l => l.title)].filter(Boolean).join(' ');
  const direct = careerSectors.filter(sector => sector.terms.test(own));
  return (direct.length ? direct : careerSectors.filter(sector => sector.terms.test(course.title || ''))).map(sector => sector.name);
}
export function sectorForTrack(track) {
  return careerSectors.find(sector => sector.roles.includes(track.title)) || careerSectors.find(sector => sector.terms.test(`${track.title} ${track.focus || ''}`));
}
export function sectorCareerTracks(tracks, modules) {
  return tracks.flatMap(track => {
    const sector = sectorForTrack(track);
    const supporting = sector ? modules.filter(module => module.sectors.includes(sector.name)) : [];
    if (!supporting.length) return [];
    const scores = Object.fromEntries(track.required.map(area => {
      const relevant = supporting.filter(module => Number.isFinite(module.scores[area]));
      const finals = [...new Map(relevant.filter(module => Number.isFinite(module.finalAssessmentScore)).map(module => [module.courseId, module.finalAssessmentScore])).values()];
      const values = [...relevant.map(module => module.scores[area]), ...finals];
      return [area, values.length ? Math.round(values.reduce((a,b) => a+b,0) / values.length) : null];
    }));
    const known = track.required.filter(area => scores[area] !== null);
    if (!known.length) return [];
    const average = Math.round(known.reduce((sum,area) => sum + scores[area],0) / known.length);
    const coverage = Math.round(100 * known.length / track.required.length);
    return [{ ...track, sector: sector.name, rank: Math.round(average * .65 + coverage * .35),
      assessedAreas: known.length, totalAreas: track.required.length, coverage, average,
      label: known.length < track.required.length ? 'More evidence needed' : 'Learning evidence available',
      strengths: known.filter(area => scores[area] >= 75), gaps: track.required.filter(area => scores[area] === null || scores[area] < 75),
      supportingModules: supporting.flatMap(module => {
        const areas = Object.entries(module.scores).filter(([area]) => track.required.includes(area)).map(([name,score]) => ({ name,score }));
        return areas.length ? [{ evidenceIndex: modules.indexOf(module), title: module.title, score: module.score, retakeHistoryAvailable: module.retakeHistoryAvailable, retakesBeforePass: module.retakesBeforePass, percent: module.percent, areas, certificateEarned: module.certificateEarned, finalAssessmentScore: module.finalAssessmentScore }] : [];
      }) }];
  }).sort((a,b) => b.rank - a.rank || a.title.localeCompare(b.title));
}
