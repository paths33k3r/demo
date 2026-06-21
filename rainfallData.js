// Hardcoded initial data for 2025 Rainfall Record based on screenshot
// MM TO MONTH (cumulative) will be calculated dynamically by the application

const INITIAL_RAINFALL_2025 = {
    "JAN": { days: 25.00, mm: 1059.00 },
    "FEB": { days: 14.00, mm: 415.00 },
    "MAR": { days: 22.00, mm: 524.00 },
    "APR": { days: 19.00, mm: 344.00 },
    "MAY": { days: 16.00, mm: 295.00 },
    "JUN": { days: 15.00, mm: 172.00 },
    "JUL": { days: 11.00, mm: 86.00 },
    "AUG": { days: 15.00, mm: 166.00 },
    "SEP": { days: 16.00, mm: 298.00 },
    "OCT": { days: 14.00, mm: 213.00 },
    "NOV": { days: 20.00, mm: 384.00 },
    "DEC": { days: 25.00, mm: 639.00 }
};

const INITIAL_RAINFALL_2026 = {
    "JAN": { days: 12.00, mm: 704.00 },
    "FEB": { days: 0, mm: 0 },
    "MAR": { days: 0, mm: 0 },
    "APR": { days: 0, mm: 0 },
    "MAY": { days: 0, mm: 0 },
    "JUN": { days: 0, mm: 0 },
    "JUL": { days: 0, mm: 0 },
    "AUG": { days: 0, mm: 0 },
    "SEP": { days: 0, mm: 0 },
    "OCT": { days: 0, mm: 0 },
    "NOV": { days: 0, mm: 0 },
    "DEC": { days: 0, mm: 0 }
};

// Helper function to create an empty year template (all zeros)
function createEmptyRainfallYear() {
    return {
        "JAN": { days: 0, mm: 0 },
        "FEB": { days: 0, mm: 0 },
        "MAR": { days: 0, mm: 0 },
        "APR": { days: 0, mm: 0 },
        "MAY": { days: 0, mm: 0 },
        "JUN": { days: 0, mm: 0 },
        "JUL": { days: 0, mm: 0 },
        "AUG": { days: 0, mm: 0 },
        "SEP": { days: 0, mm: 0 },
        "OCT": { days: 0, mm: 0 },
        "NOV": { days: 0, mm: 0 },
        "DEC": { days: 0, mm: 0 }
    };
}
