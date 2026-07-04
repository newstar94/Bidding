export function parseYearMonth(dateStr) {
    if (!dateStr) return { year: null, month: null };
    const cleaned = String(dateStr).replace(/\s*-\s*/, ' ').trim();
    if (cleaned.match(/^\d{4}-\d{2}-\d{2}/)) {
        return {
            year: cleaned.substring(0, 4),
            month: parseInt(cleaned.substring(5, 7), 10).toString()
        };
    }
    if (cleaned.match(/^\d{2}\/\d{2}\/\d{4}/)) {
        const parts = cleaned.split(' ')[0].split('/');
        return {
            year: parts[2],
            month: parseInt(parts[1], 10).toString()
        };
    }
    const parsed = new Date(cleaned);
    if (!Number.isNaN(parsed.getTime())) {
        return {
            year: parsed.getFullYear().toString(),
            month: (parsed.getMonth() + 1).toString()
        };
    }
    return { year: null, month: null };
}

export function sortRecords(records, field, order = 'asc') {
    if (!field) return records;
    const direction = order === 'desc' ? -1 : 1;
    records.sort((a, b) => {
        let valA = a[field] ?? '';
        let valB = b[field] ?? '';
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return -1 * direction;
        if (valA > valB) return 1 * direction;
        return 0;
    });
    return records;
}
