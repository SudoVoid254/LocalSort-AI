/**
 * geocoder.js - Simple local reverse geocoding
 */

const CITIES = [
    { name: "London", country: "UK", lat: 51.5074, lon: -0.1278 },
    { name: "New York", country: "USA", lat: 40.7128, lon: -74.0060 },
    { name: "Paris", country: "France", lat: 48.8566, lon: 2.3522 },
    { name: "Tokyo", country: "Japan", lat: 35.6762, lon: 139.6503 },
    { name: "San Francisco", country: "USA", lat: 37.7749, lon: -122.4194 },
    { name: "Berlin", country: "Germany", lat: 52.5200, lon: 13.4050 },
    { name: "Sydney", country: "Australia", lat: -33.8688, lon: 151.2093 },
    { name: "Rome", country: "Italy", lat: 41.9028, lon: 12.4964 },
    { name: "Barcelona", country: "Spain", lat: 41.3851, lon: 2.1734 },
    { name: "Athens", country: "Greece", lat: 37.9838, lon: 23.7275 }
];

export function reverseGeocode(lat, lon) {
    if (lat === null || lon === null) return { city: "Unknown", country: "Unknown" };

    let closest = null;
    let minDistance = Infinity;

    for (const city of CITIES) {
        const d = getDistance(lat, lon, city.lat, city.lon);
        if (d < minDistance) {
            minDistance = d;
            closest = city;
        }
    }

    // Only return if within a reasonable distance (e.g. 100km)
    if (minDistance < 100) {
        return { city: closest.name, country: closest.country };
    }

    return { city: "Remote", country: "Unknown" };
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}
