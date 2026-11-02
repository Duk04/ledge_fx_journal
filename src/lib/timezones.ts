/**
 * A curated ~40-zone list for the Profile timezone Select, rather than the
 * full ~400-entry IANA database — enough coverage for every major trading
 * center and population center, with a readable label ("City — UTC+08:00").
 * `Asia/Ulaanbaatar` is included deliberately: it's the seeded demo user's
 * timezone (see prisma/seed.ts).
 */
export type TimezoneOption = { value: string; label: string };

export const IANA_TIMEZONES: TimezoneOption[] = [
  { value: "Pacific/Midway", label: "Midway — UTC-11:00" },
  { value: "Pacific/Honolulu", label: "Honolulu — UTC-10:00" },
  { value: "America/Anchorage", label: "Anchorage — UTC-09:00" },
  { value: "America/Los_Angeles", label: "Los Angeles — UTC-08:00" },
  { value: "America/Denver", label: "Denver — UTC-07:00" },
  { value: "America/Chicago", label: "Chicago — UTC-06:00" },
  { value: "America/Mexico_City", label: "Mexico City — UTC-06:00" },
  { value: "America/New_York", label: "New York — UTC-05:00" },
  { value: "America/Toronto", label: "Toronto — UTC-05:00" },
  { value: "America/Bogota", label: "Bogotá — UTC-05:00" },
  { value: "America/Santiago", label: "Santiago — UTC-04:00" },
  { value: "America/Sao_Paulo", label: "São Paulo — UTC-03:00" },
  { value: "Atlantic/Azores", label: "Azores — UTC-01:00" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "London — UTC+00:00" },
  { value: "Europe/Lisbon", label: "Lisbon — UTC+00:00" },
  { value: "Europe/Paris", label: "Paris — UTC+01:00" },
  { value: "Europe/Berlin", label: "Berlin — UTC+01:00" },
  { value: "Europe/Madrid", label: "Madrid — UTC+01:00" },
  { value: "Africa/Lagos", label: "Lagos — UTC+01:00" },
  { value: "Europe/Athens", label: "Athens — UTC+02:00" },
  { value: "Europe/Kyiv", label: "Kyiv — UTC+02:00" },
  { value: "Africa/Johannesburg", label: "Johannesburg — UTC+02:00" },
  { value: "Europe/Moscow", label: "Moscow — UTC+03:00" },
  { value: "Asia/Istanbul", label: "Istanbul — UTC+03:00" },
  { value: "Asia/Riyadh", label: "Riyadh — UTC+03:00" },
  { value: "Asia/Tehran", label: "Tehran — UTC+03:30" },
  { value: "Asia/Dubai", label: "Dubai — UTC+04:00" },
  { value: "Asia/Baku", label: "Baku — UTC+04:00" },
  { value: "Asia/Karachi", label: "Karachi — UTC+05:00" },
  { value: "Asia/Kolkata", label: "Mumbai / Delhi — UTC+05:30" },
  { value: "Asia/Dhaka", label: "Dhaka — UTC+06:00" },
  { value: "Asia/Bangkok", label: "Bangkok — UTC+07:00" },
  { value: "Asia/Jakarta", label: "Jakarta — UTC+07:00" },
  { value: "Asia/Shanghai", label: "Shanghai — UTC+08:00" },
  { value: "Asia/Singapore", label: "Singapore — UTC+08:00" },
  { value: "Asia/Hong_Kong", label: "Hong Kong — UTC+08:00" },
  { value: "Asia/Ulaanbaatar", label: "Ulaanbaatar — UTC+08:00" },
  { value: "Asia/Tokyo", label: "Tokyo — UTC+09:00" },
  { value: "Asia/Seoul", label: "Seoul — UTC+09:00" },
  { value: "Australia/Sydney", label: "Sydney — UTC+10:00/+11:00" },
  { value: "Pacific/Auckland", label: "Auckland — UTC+12:00/+13:00" },
];
