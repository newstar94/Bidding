export function parseBidDateTime(value) {
    if (!value) return null;

    const cleaned = String(value).replace('T', ' ').trim();

    const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2})(?::\d{2})?$/);
    if (isoMatch) {
        const [, year, month, day, hour, minute] = isoMatch;
        return new Date(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour),
            Number(minute)
        );
    }

    const parts = cleaned.split(/\s+/);
    if (parts.length >= 2) {
        const dateParts = parts[0].split('/');
        const timeParts = parts[1].split(':');
        if (dateParts.length >= 3 && timeParts.length >= 2) {
            return new Date(
                Number(dateParts[2]),
                Number(dateParts[1]) - 1,
                Number(dateParts[0]),
                Number(timeParts[0]),
                Number(timeParts[1])
            );
        }
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
