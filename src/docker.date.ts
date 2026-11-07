// Docker prints dates in the Go format "2006-01-02 15:04:05.999999999 -0700 MST".
// We ignore the fractional seconds and the zone name.
const dockerDatePattern =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)? ([+-]\d{2})(\d{2})/;

// Returns an invalid Date (NaN time) when the text does not match.
export const parseDockerDate = (date: string): Date => {
  const match = dockerDatePattern.exec(date);
  if (!match) {
    return new Date(NaN);
  }
  const [, day, time, offsetHours, offsetMinutes] = match;
  return new Date(`${day}T${time}${offsetHours}:${offsetMinutes}`);
};
